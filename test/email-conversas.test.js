'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
test('avisos privados e respostas recebidas sem revelar conversas anônimas',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'amigo-email-chat-'));
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:dir,APP_SECRET:'teste-chat-email-'.repeat(4),BASE_URL:'https://familia.example.com',SMTP_HOST:'smtp.example.com',SMTP_USER:'app@gmail.com',SMTP_PASS:'teste',EMAIL_REMETENTE:'app@gmail.com',RESPOSTAS_POR_EMAIL:'habilitado'});
 const {db}=require('../src/db'),seg=require('../src/seguranca'),s=require('../src/servico'),email=require('../src/email'),mod=require('../src/email-conversas');
 db.exec("INSERT INTO grupos(id,nome) VALUES(1,'Família');INSERT INTO edicoes(id,grupo_id,nome,ano) VALUES(1,1,'Nossa edição',2026)");
 for(let id=1;id<=3;id++){db.prepare('INSERT INTO pessoas(id,nome,email,email_verificado) VALUES(?,?,?,?)').run(id,['Ana','Bruno','Clara'][id-1],`p${id}@gmail.com`,`p${id}@gmail.com`);db.prepare("INSERT INTO participacoes(id,edicao_id,pessoa_id,token,status,pin_hash) VALUES(?,1,?,?,'confirmado',?)").run(id,id,`token-${id}`,seg.hashPin('1234'));}
 const conversa={id:'privada',edicao_id:1,tipo:'privada',vinculos_cifrados:seg.cifrar('[1,2]','conversa:privada')};
 db.prepare('INSERT INTO conversas(id,edicao_id,tipo,vinculos_cifrados) VALUES(?,?,?,?)').run(conversa.id,1,conversa.tipo,conversa.vinculos_cifrados);
 db.prepare('INSERT INTO mensagens_interacao(id,edicao_id,conversa_id,conteudo_cifrado,criado_em) VALUES(?,1,?,?,?)').run('original',conversa.id,seg.cifrar(JSON.stringify({autor:1,texto:'Qual livro você quer?'}),'mensagem:original'),new Date().toISOString());
 let aviso,alias;
 const raw=(id,texto='Quero um romance!',from='p2@gmail.com',extra='',auth='mx.google.com; dmarc=pass header.from=gmail.com')=>Buffer.from(`From: ${from}\r\nTo: ${alias}\r\nMessage-ID: <${id}@gmail.com>\r\nAuthentication-Results: ${auth}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${texto}`);
 try{
  await t.test('notifica só o destinatário verificado, com endereço aleatório',()=>{
   mod.notificar(conversa,1,'original','Qual livro você quer?');
   const fila=db.prepare('SELECT * FROM fila_email').all();assert.equal(fila.length,1);aviso=JSON.parse(seg.decifrar(fila[0].conteudo,`email:${fila[0].id}`));alias=aviso.replyTo;
   assert.equal(aviso.destino,'p2@gmail.com');assert.match(aviso.texto,/Qual livro/);assert.match(alias,/^app\+ao-[a-f0-9]{32}@gmail.com$/);
   assert.ok(!aviso.texto.includes('p1@gmail.com'));assert.ok(!db.prepare('SELECT contexto FROM respostas_email').get().contexto.includes('p2@gmail.com'));
   mod.notificar(conversa,1,'original','Qual livro você quer?');assert.equal(db.prepare('SELECT COUNT(*) n FROM fila_email').get().n,1);
  });
  await t.test('importa resposta e remove histórico citado e assinatura',async()=>{
   assert.equal(await mod.importar(raw('resposta-1','Quero um romance!\n\nEm quarta-feira, Ana escreveu:\n> Qual livro você quer?'),'uid1'),'importada');
   const msg=db.prepare("SELECT * FROM mensagens_interacao WHERE id<>'original'").get();const texto=JSON.parse(seg.decifrar(msg.conteudo_cifrado,`mensagem:${msg.id}`));assert.deepEqual(texto,{autor:2,texto:'Quero um romance!'});
   const outro=db.prepare('SELECT * FROM fila_email WHERE id<>?').get(email.sha('mensagem:original:2'));const m=JSON.parse(seg.decifrar(outro.conteudo,`email:${outro.id}`));assert.equal(m.destino,'p1@gmail.com');assert.match(m.texto,/Bruno/);assert.doesNotMatch(m.texto,/p2@gmail.com/);
  });
  await t.test('não duplica por UID nem por Message-ID',async()=>{
   assert.equal(await mod.importar(raw('resposta-1'),'uid1'),'duplicada');assert.equal(await mod.importar(raw('resposta-1'),'uid2'),'duplicada');assert.equal(db.prepare('SELECT COUNT(*) n FROM mensagens_interacao').get().n,2);
  });
  await t.test('recusa remetente falso, autenticação falha e resposta automática',async()=>{
   assert.equal(await mod.importar(raw('falso','texto','invasor@gmail.com'),'uid3'),'remetente-recusado');
   assert.equal(await mod.importar(raw('sem-auth','texto','p2@gmail.com','','mx.google.com; dmarc=fail'),'uid4'),'autenticacao-recusada');
   assert.equal(await mod.importar(raw('robo','texto','p2@gmail.com','Auto-Submitted: auto-replied\r\n'),'uid5'),'automatica');
   assert.equal(await mod.importar(raw('grande','x'.repeat(1001)),'uid6'),'texto-invalido');
  });
  await t.test('revoga endereço de resposta após mudança de PIN ou e-mail',async()=>{
   const pin=db.prepare('SELECT pin_hash FROM participacoes WHERE id=2').get().pin_hash;
   db.prepare('UPDATE participacoes SET pin_hash=? WHERE id=2').run(seg.hashPin('5678'));assert.equal(await mod.importar(raw('pin'),'uid7'),'acesso-revogado');db.prepare('UPDATE participacoes SET pin_hash=? WHERE id=2').run(pin);
   db.prepare("UPDATE pessoas SET email='novo@gmail.com' WHERE id=2").run();assert.equal(await mod.importar(raw('email'),'uid8'),'acesso-revogado');db.prepare("UPDATE pessoas SET email='p2@gmail.com' WHERE id=2").run();
  });
  await t.test('conversa anônima envia apenas link, sem autor, texto ou resposta',()=>{
   s.executarSorteio(1);const e=s.q.edicao.get(1);const c={id:'anonima',edicao_id:1,tipo:'anonima',vinculos_cifrados:seg.cifrar('[1,2]','conversa:anonima'),sorteio_versao:e.sorteio_versao};
   mod.notificar(c,1,'anonima-mensagem','Eu sou a Ana, este conteúdo não pode ir por e-mail');const fila=db.prepare('SELECT * FROM fila_email WHERE id=?').get(email.sha('mensagem:anonima-mensagem:2'));const m=JSON.parse(seg.decifrar(fila.conteudo,`email:${fila.id}`));assert.equal(m.replyTo,undefined);assert.doesNotMatch(m.texto,/Ana|Bruno|este conteúdo|p1@gmail.com/);assert.match(m.texto,/interacoes/);
  });
  await t.test('endereço expirado não recebe resposta',async()=>{
   db.prepare("UPDATE respostas_email SET expira_em='2020-01-01'").run();assert.equal(await mod.importar(raw('expirou'),'uid9'),'expirada');
  });
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
