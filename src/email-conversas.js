'use strict';
const crypto=require('crypto');
const {db}=require('./db');
const seg=require('./seguranca');
const email=require('./email');
const {simpleParser}=require('mailparser');
const {ImapFlow}=require('imapflow');
db.exec(`CREATE TABLE IF NOT EXISTS respostas_email (
 hash TEXT PRIMARY KEY, contexto TEXT NOT NULL, expira_em TEXT NOT NULL
); CREATE TABLE IF NOT EXISTS entradas_email (
 chave TEXT PRIMARY KEY, estado TEXT NOT NULL, criado_em TEXT NOT NULL
); CREATE TABLE IF NOT EXISTS estado_imap (
 conta TEXT PRIMARY KEY, validade TEXT NOT NULL, ultimo_uid INTEGER NOT NULL
);`);
const agora=()=>new Date().toISOString();
const ids=c=>JSON.parse(seg.decifrar(c.vinculos_cifrados,`conversa:${c.id}`));
function notificar(c,autor,mensagemId,texto) {
 if(!c || !email.configurado())return;
 const s=require('./servico'),e=s.q.edicao.get(c.edicao_id);
 const destino=ids(c).find(x=>x!==autor),p=s.q.participacao.get(destino),contato=p&&email.contato(p);
 if(!p || p.status!=='confirmado' || !contato?.email || contato.email_verificado!==contato.email)return;
 if(c.tipo==='anonima'&&(e.status!=='sorteada'||c.sorteio_versao!==(e.sorteio_versao||e.sorteado_em)))return;
 const link=`${new URL(process.env.BASE_URL).origin}/c/${p.token}/interacoes?conversa=${c.id}`;
 const key=email.sha(`mensagem:${mensagemId}:${p.id}`);
 if(db.prepare('SELECT 1 FROM fila_email WHERE id=?').get(key))return;
 let corpo,replyTo;
 if(c.tipo==='privada') {
  const nome=s.q.participacao.get(autor)?.nome||'Participante';
  corpo=`Nova mensagem de ${nome} para o perfil ${p.nome}:\n\n${texto}\n\n--- RESPONDA ACIMA DESTA LINHA ---\nUse Responder para enviar sua resposta ao aplicativo (até 1.000 caracteres, sem anexos). Responda pelo e-mail verificado. O endereço de resposta vale por 14 dias.\nNão encaminhe este e-mail. Para abrir a conversa: ${link}\nO conteúdo permanece na caixa de e-mail mesmo se for apagado no aplicativo.`;
  if(process.env.RESPOSTAS_POR_EMAIL==='habilitado') {
   const token=crypto.randomBytes(16).toString('hex'),hash=email.sha(token);
   const contexto={conversa:c.id,pessoa:p.id,email:contato.email,pin:email.sha(p.pin_hash||''),mensagem:mensagemId};
   db.prepare('INSERT INTO respostas_email(hash,contexto,expira_em) VALUES(?,?,?)').run(hash,seg.cifrar(JSON.stringify(contexto),`resposta:${hash}`),new Date(Date.now()+14*86400e3).toISOString());
   const [local,dominio]=process.env.EMAIL_REMETENTE.split('@');replyTo=`${local}+ao-${token}@${dominio}`;
  } else corpo=`Nova mensagem de ${nome} para ${p.nome}:\n\n${texto}\n\nAbra a conversa para responder: ${link}`;
 } else corpo=`Você tem uma nova mensagem na conversa anônima do Amigo Oculto.\nAbra o aplicativo para ler e responder: ${link}\nNão responda a este e-mail. O conteúdo e a identidade permanecem protegidos no aplicativo.`;
 email.enfileirar(key,p,contato.email,`${e.nome} - Nova mensagem privada`,corpo,{replyTo,conversa:c.id,mensagem:mensagemId,pessoa:p.id});
}
function textoNovo(texto) {
 const linhas=String(texto||'').replace(/\r/g,'').split('\n'),novas=[];
 for(const l of linhas) {
  if(/^\s*(>|--- RESPONDA ACIMA|--\s*$|On .+wrote:|Em .+escreveu:|El .+escribi[oó]:|De:|From:|_{5,}|-{5,})/i.test(l))break;
  novas.push(l);
 }
 return novas.join('\n').trim();
}
async function importar(source,chave) {
 if(db.prepare('SELECT 1 FROM entradas_email WHERE chave=?').get(chave))return 'duplicada';
 const registrar=estado=>{db.prepare('INSERT OR IGNORE INTO entradas_email(chave,estado,criado_em) VALUES(?,?,?)').run(chave,estado,agora());return estado;};
 if(source.length>128*1024)return registrar('grande');
 const m=await simpleParser(source,{skipImageLinks:true});
 const destino=(m.to?.value||[]).map(x=>x.address?.toLowerCase()).find(x=>/\+ao-[a-f0-9]{32}@/.test(x||''));
 if(!destino)return registrar('ignorada');
 const [local,dominio]=process.env.EMAIL_REMETENTE.toLowerCase().split('@');
 if(!destino.startsWith(local+'+ao-')||!destino.endsWith('@'+dominio))return registrar('ignorada');
 const token=destino.match(/\+ao-([a-f0-9]{32})@/)[1],hash=email.sha(token);
 const l=db.prepare('SELECT * FROM respostas_email WHERE hash=? AND expira_em>?').get(hash,agora());
 if(!l)return registrar('expirada');
 const auth=m.headers.get('authentication-results'),primeiro=Array.isArray(auth)?auth[0]:auth;
 // Somente o resultado de autenticação adicionado pelo servidor receptor Gmail.
 if(!/^mx\.google\.com;/i.test(String(primeiro||'').trim())||!/(?:^|[;\s])dmarc=pass(?:[;\s(]|$)/i.test(primeiro))return registrar('autenticacao-recusada');
 if((m.headers.get('auto-submitted')&&m.headers.get('auto-submitted')!=='no')||/bulk|list|junk/i.test(m.headers.get('precedence')||'')||m.headers.has('list-id')||m.headers.has('x-autoreply')||m.headers.has('x-autorespond'))return registrar('automatica');
 const contexto=JSON.parse(seg.decifrar(l.contexto,`resposta:${hash}`)),s=require('./servico');
 const p=s.q.participacao.get(contexto.pessoa),c=db.prepare('SELECT * FROM conversas WHERE id=?').get(contexto.conversa),contato=p&&email.contato(p);
 if(!p||p.status!=='confirmado'||!c||c.tipo!=='privada'||c.edicao_id!==p.edicao_id||!ids(c).includes(p.id)||email.sha(p.pin_hash||'')!==contexto.pin||contato?.email!==contexto.email||contato?.email_verificado!==contato?.email||!db.prepare('SELECT 1 FROM mensagens_interacao WHERE id=? AND conversa_id=?').get(contexto.mensagem,c.id))return registrar('acesso-revogado');
 if(m.from?.value?.length!==1||m.from.value[0].address.toLowerCase()!==contexto.email.toLowerCase())return registrar('remetente-recusado');
 const texto=textoNovo(m.text);
 if(!texto||texto.length>1000)return registrar('texto-invalido');
 const messageKey=m.messageId&&email.sha(m.messageId);
 if(messageKey&&db.prepare('SELECT 1 FROM entradas_email WHERE chave=?').get('id:'+messageKey))return registrar('duplicada');
 const recentes=db.prepare('SELECT COUNT(*) n FROM entradas_email WHERE estado=? AND criado_em>?').get(`importada:${p.id}`,new Date(Date.now()-60000).toISOString()).n;
 if(recentes>=5)return registrar('limite');
 db.transaction(()=>{
  const id=crypto.randomUUID();
  db.prepare('INSERT INTO mensagens_interacao(id,edicao_id,conversa_id,conteudo_cifrado,criado_em) VALUES(?,?,?,?,?)').run(id,p.edicao_id,c.id,seg.cifrar(JSON.stringify({autor:p.id,texto}),`mensagem:${id}`),agora());
  registrar(`importada:${p.id}`);
  if(messageKey)db.prepare('INSERT INTO entradas_email(chave,estado,criado_em) VALUES(?,?,?)').run('id:'+messageKey,'deduplicacao',agora());
  notificar(c,p.id,id,texto);
 })();
 return 'importada';
}
let ocupado=false;
const status={ativo:false,ultimaConsulta:null,erro:null};
async function receber() {
 if(ocupado||!email.configurado()||process.env.RESPOSTAS_POR_EMAIL!=='habilitado')return;
 ocupado=true;
 const client=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
 client.on('error',()=>{});
 try {
  await client.connect();await client.mailboxOpen('INBOX',{readOnly:true});
  const conta=process.env.SMTP_USER,validade=String(client.mailbox.uidValidity);
  const salvo=db.prepare('SELECT * FROM estado_imap WHERE conta=?').get(conta);
  const ultimo=salvo?.validade===validade?salvo.ultimo_uid:0;
  const uids=(await client.search({uid:`${ultimo+1}:*`,header:{to:conta.split('@')[0]+'+ao-'}},{uid:true})).filter(uid=>uid>ultimo).sort((a,b)=>a-b).slice(0,100);
  for(const uid of uids) {
   const info=await client.fetchOne(uid,{size:true},{uid:true});
   if(info?.size<=128*1024) {const m=await client.fetchOne(uid,{source:true},{uid:true});if(m?.source)await importar(m.source,email.sha(`${conta}:${validade}:${uid}`));}
   db.prepare('INSERT INTO estado_imap(conta,validade,ultimo_uid) VALUES(?,?,?) ON CONFLICT(conta) DO UPDATE SET validade=excluded.validade,ultimo_uid=excluded.ultimo_uid').run(conta,validade,uid);
  }
  status.ativo=true;status.ultimaConsulta=agora();status.erro=null;
 } catch {status.ativo=false;status.erro='Não foi possível consultar o Gmail. Confira a conta, conexão e senha de aplicativo.';}
 finally {await client.logout().catch(()=>client.close());ocupado=false;}
}
module.exports={notificar,importar,receber,status,textoNovo};
