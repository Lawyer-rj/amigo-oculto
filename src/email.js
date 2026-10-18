'use strict';
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const seg = require('./seguranca');
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const agora = () => new Date().toISOString();
db.prepare("UPDATE fila_email SET estado='incerto' WHERE estado='enviando'").run();
const valido = v => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v || '');
function configurado() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && valido(process.env.EMAIL_REMETENTE)); }
function base() {
 const u = new URL(process.env.BASE_URL || 'http://localhost:3000');
 if (u.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('Configure um endereço HTTPS para os e-mails.');
 return u.origin;
}
function contato(p) {
 return db.prepare('SELECT * FROM pessoas WHERE id=?').get(p.responsavel_id || p.pessoa_id);
}
function enfileirar(id, p, destino, assunto, texto, opcoes = {}) {
 if (!configurado() || !valido(destino)) return false;
 const conteudo = seg.cifrar(JSON.stringify({destino, assunto, texto, ...opcoes}), `email:${id}`);
 return !!db.prepare('INSERT OR IGNORE INTO fila_email (id,participacao_id,conteudo,criado_em,atualizado_em) VALUES (?,?,?,?,?)').run(id,p.id,conteudo,agora(),agora()).changes;
}
function criarLink(p,tipo) {
 if(!configurado()) throw new Error('O envio de e-mail ainda não foi configurado. Fale com o organizador.');
 const c=contato(p);
 if(!valido(c?.email)) throw new Error('Cadastre um e-mail no seu perfil ou no cadastro do responsável.');
 if(tipo==='recuperar' && c.email_verificado!==c.email) throw new Error('O e-mail precisa ser verificado antes da recuperação. Fale com o organizador se perdeu o PIN.');
 const ultima=db.prepare('SELECT criado_em FROM fila_email WHERE participacao_id=? AND id LIKE ? ORDER BY criado_em DESC LIMIT 1').get(p.id,`link-${tipo}-%`);
 if(ultima && Date.now()-Date.parse(ultima.criado_em)<60000) throw new Error('Aguarde um minuto antes de pedir outro e-mail.');
 const token=crypto.randomBytes(32).toString('base64url'), hash=sha(token);
 const link=`${base()}/c/${p.token}/email/${token}`;
 db.transaction(()=>{
  db.prepare('DELETE FROM links_email WHERE participacao_id=? AND tipo=?').run(p.id,tipo);
  db.prepare('INSERT INTO links_email (hash,participacao_id,tipo,destino,pin_versao,expira_em) VALUES (?,?,?,?,?,?)').run(hash,p.id,tipo,c.email,sha(p.pin_hash||''),new Date(Date.now()+30*60e3).toISOString());
  enfileirar(`link-${tipo}-${hash}`,p,c.email,tipo==='recuperar'?'Recuperar seu PIN':'Verificar seu e-mail',`Olá!\n\n${tipo==='recuperar'?'Crie um novo PIN':'Confirme seu e-mail'} para o perfil de ${p.nome}:\n${link}\n\nEste link vale por 30 minutos e só pode ser usado uma vez. Se não pediu esta mensagem, ignore-a. Não encaminhe o link.`);
 })();
 return hash;
}
function lerLink(p,token) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token||'')) return null;
 const l=db.prepare('SELECT * FROM links_email WHERE hash=? AND participacao_id=? AND usado_em IS NULL AND expira_em>? AND pin_versao=?').get(sha(token),p.id,agora(),sha(p.pin_hash||''));
 const c=contato(p);
 return l && l.destino===c?.email && (l.tipo!=='recuperar' || c.email_verificado===c.email) ? l : null;
}
function aviso(p,e,tipo) {
 const c=contato(p);
 if(!c || c.email_verificado!==c.email) return false;
 const acao={confirmacao:'Sua participação foi confirmada! Complete sua foto e sugestões.',resultado:'O sorteio está pronto! Entre com seu PIN para abrir a raspadinha.',confirmar:'O prazo para confirmar sua participação termina em breve.',sugestoes:'O prazo para preencher suas sugestões termina em breve.',entrega:'Nossa troca de presentes está chegando!',encerramento:'O álbum da nossa edição está disponível no aplicativo.'}[tipo];
 const versao=tipo==='resultado' ? e.sorteio_versao : tipo==='confirmar'?e.prazo_confirmacao:tipo==='sugestoes'?e.prazo_sugestoes:tipo==='entrega'?e.entrega_em:tipo==='encerramento'?e.encerrada_em:'confirmado';
 return enfileirar(sha([p.id,tipo,versao,c.email].join(':')),p,c.email,`${e.nome} - ${tipo==='resultado'?'Sua raspadinha está pronta':'Uma mensagem para você'}`,`Olá, ${c.nome}!\n\n${acao}\nPerfil: ${p.nome}\n${base()}/c/${p.token}\n\nO link é pessoal. O resultado permanece protegido dentro do aplicativo.`);
}
let ocupado=false;
async function processar() {
 if(ocupado || !configurado()) return;
 ocupado=true;
 const port=Number(process.env.SMTP_PORT||587);
 const smtp=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
 try {
  for(const item of db.prepare("SELECT * FROM fila_email WHERE estado='pendente' ORDER BY criado_em LIMIT 10").all()) {
   const m=JSON.parse(seg.decifrar(item.conteudo,`email:${item.id}`));
   if(m.mensagem && !db.prepare('SELECT 1 FROM mensagens_interacao WHERE id=? AND conversa_id=?').get(m.mensagem,m.conversa)) { db.prepare("UPDATE fila_email SET estado='cancelado' WHERE id=?").run(item.id); continue; }
   if(m.pessoa) { const pessoa=require('./servico').q.participacao.get(m.pessoa),c=pessoa&&contato(pessoa); if(!c||c.email!==m.destino||c.email_verificado!==c.email){db.prepare("UPDATE fila_email SET estado='cancelado' WHERE id=?").run(item.id);continue;} }
   db.prepare("UPDATE fila_email SET estado='enviando',atualizado_em=? WHERE id=?").run(agora(),item.id);
   try {
    await smtp.sendMail({from:process.env.EMAIL_REMETENTE,to:m.destino,subject:m.assunto,text:m.texto,...(m.replyTo?{replyTo:m.replyTo}:{}),headers:{'X-Auto-Response-Suppress':'All'},messageId:`<${item.id}@${process.env.EMAIL_REMETENTE.split('@')[1]}>`});
    db.prepare("UPDATE fila_email SET estado='aceito',atualizado_em=? WHERE id=?").run(agora(),item.id);
   } catch { db.prepare("UPDATE fila_email SET estado='incerto',atualizado_em=? WHERE id=?").run(agora(),item.id); }
  }
 } finally { smtp.close(); ocupado=false; }
}
function lembretes() {
 if(!configurado()) return;
 const s=require('./servico');
 for(const e of db.prepare('SELECT * FROM edicoes WHERE encerrada_em IS NULL').all()) {
  for(const p of db.prepare('SELECT id FROM participacoes WHERE edicao_id=?').all(e.id).map(x=>s.q.participacao.get(x.id))) {
   if(e.status==='sorteada' && db.prepare('SELECT 1 FROM pares WHERE participacao_id=?').get(p.id)) aviso(p,e,'resultado');
   for(const [tipo,data,permitido] of [['confirmar',e.prazo_confirmacao,p.status==='pendente'],['sugestoes',e.prazo_sugestoes,p.status==='confirmado'&&e.status==='aberta'],['entrega',e.entrega_em,p.status==='confirmado']]) {
    const falta=Date.parse(data)-Date.now(); if(permitido&&falta>0&&falta<=24*3600e3) aviso(p,e,tipo);
   }
  }
 }
}
module.exports={enfileirar,configurado,contato,criarLink,lerLink,aviso,processar,lembretes,sha};
