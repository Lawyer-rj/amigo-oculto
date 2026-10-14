'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
test('sessão única, recuperação por e-mail e encerramento com álbum',async t=>{
 const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'amigo-album-'));
 Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:pasta,APP_SECRET:'teste-album-segredo-'.repeat(4),ADMIN_SENHA:'teste',BASE_URL:'http://localhost:3000'});
 delete process.env.SMTP_HOST;
 const {db}=require('../src/db'),seg=require('../src/seguranca'),s=require('../src/servico'),email=require('../src/email'),album=require('../src/album'),app=require('../src/server');
 const smtp=require('nodemailer'),original=smtp.createTransport,envios=[];
 smtp.createTransport=opts=>{assert.equal(opts.requireTLS,true);return {sendMail:async m=>{envios.push(m);return {messageId:'teste'};},close(){}};};
 db.exec(`INSERT INTO grupos(id,nome) VALUES(1,'Família de demonstração');INSERT INTO edicoes(id,grupo_id,nome,ano) VALUES(1,1,'Amigo Oculto 2026',2026);
 INSERT INTO pessoas(id,nome,email) VALUES(1,'Ana','ana@example.com'),(2,'Bruno','bruno@example.com'),(3,'Clara','clara@example.com');
 INSERT INTO participacoes(id,edicao_id,pessoa_id,token) VALUES(1,1,1,'ana'),(2,1,2,'bruno'),(3,1,3,'clara');`);
 const server=await new Promise(resolve=>{const sv=app.listen(0,'127.0.0.1',()=>resolve(sv));}),base=`http://127.0.0.1:${server.address().port}`;
 let cookie,csrf,antigo,linkRecuperar;
 const admin=`ao_admin=${seg.assinarSessao()}`;
 const post=(url,body={},auth='')=>fetch(base+url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',...(auth?{cookie:auth}:{})},body:new URLSearchParams(body)});
 const get=(url,auth='')=>fetch(base+url,{redirect:'manual',headers:auth?{cookie:auth}:{}});
 const tokenDoEmail=m=>m.text.match(/\/email\/([A-Za-z0-9_-]{43})/)[1];
 try {
  await t.test('confirmar inicia sessão e permite várias alterações sem PIN, com CSRF',async()=>{
   for(const token of ['ana','bruno','clara']) {const r=await post(`/c/${token}/confirmar`,{resposta:'confirmado',pin:'1234',pin2:'1234'});assert.equal(r.status,303);if(token==='ana')cookie=r.headers.get('set-cookie').split(';')[0];}
   const html=await (await get('/c/ana',cookie)).text();assert.doesNotMatch(html,/data-recuperacao|Seu PIN para salvar/);csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
   for(const nome of ['Ana','Ana']) {const r=await post('/c/ana/dados',{nome,email:'ana@example.com',csrf},cookie);assert.equal(r.status,303);assert.equal(r.headers.get('set-cookie'),null);}
   assert.equal((await post('/c/ana/dados',{nome:'Invasor',csrf:'errado',pin_atual:'1234'},cookie)).status,403);
   assert.equal((await post('/c/ana/sugestoes',{texto0:'Um livro',csrf},cookie)).status,303);
   assert.equal((await get('/c/ana/interacoes',cookie)).status,200);
  });
  await t.test('verificação e recuperação enviam links sem expor pares, com uso único',async()=>{
   Object.assign(process.env,{SMTP_HOST:'smtp.example.com',SMTP_USER:'teste',SMTP_PASS:'teste',EMAIL_REMETENTE:'amigo@example.com'});
   assert.throws(()=>email.criarLink(s.q.participacao.get(1),'recuperar'),/verificado/);
   email.criarLink(s.q.participacao.get(1),'verificar');await email.processar();
   const chave=tokenDoEmail(envios.at(-1));assert.equal((await post('/c/ana/email/'+chave)).status,303);
   assert.equal(db.prepare('SELECT email_verificado FROM pessoas WHERE id=1').get().email_verificado,'ana@example.com');
   assert.equal((await post('/c/ana/email/'+chave)).status,400);
   await email.processar();
   s.executarSorteio(1);email.lembretes();await email.processar();
   const resultado=envios.find(m=>m.subject.includes('raspadinha'));assert.ok(resultado);assert.doesNotMatch(resultado.text,/Bruno|Clara/);
   const r=await post('/c/ana/revelar',{csrf},cookie);assert.equal(r.status,200);assert.ok((await r.json()).nome);
   assert.equal((await post('/c/ana/revelar',{csrf:'errado'},cookie)).status,403);
   email.criarLink(s.q.participacao.get(1),'recuperar');await email.processar();linkRecuperar=tokenDoEmail(envios.at(-1));
   assert.ok(!JSON.stringify(db.prepare('SELECT * FROM links_email').all()).includes(linkRecuperar));
   assert.ok(!JSON.stringify(db.prepare('SELECT * FROM fila_email').all()).includes(linkRecuperar));
   antigo=cookie;
   const novo=await post('/c/ana/email/'+linkRecuperar,{pin:'5678',pin2:'5678'});assert.equal(novo.status,303);cookie=novo.headers.get('set-cookie').split(';')[0];
   assert.equal((await get('/c/ana/interacoes/estado',antigo)).status,401);
   assert.equal((await post('/c/ana/email/'+linkRecuperar,{pin:'7777',pin2:'7777'})).status,400);
   assert.ok(s.revelar(s.q.participacao.get(1),'5678').nome);
   const html=await (await get('/c/ana',cookie)).text();csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  });
  await t.test('links vencidos ou com e-mail alterado não recuperam o acesso',()=>{
   db.prepare("UPDATE fila_email SET criado_em='2020-01-01' WHERE id LIKE 'link-recuperar-%'").run();
   email.criarLink(s.q.participacao.get(1),'recuperar');
   const item=db.prepare("SELECT * FROM fila_email WHERE estado='pendente' AND id LIKE 'link-recuperar-%' ORDER BY criado_em DESC LIMIT 1").get();
   const chave=tokenDoEmail({text:JSON.parse(seg.decifrar(item.conteudo,`email:${item.id}`)).texto});
   db.prepare("UPDATE links_email SET expira_em='2020-01-01' WHERE participacao_id=1 AND tipo='recuperar'").run();assert.equal(email.lerLink(s.q.participacao.get(1),chave),null);
   db.prepare("UPDATE links_email SET expira_em='2099-01-01' WHERE participacao_id=1 AND tipo='recuperar'").run();db.prepare("UPDATE pessoas SET email='outro@example.com' WHERE id=1").run();assert.equal(email.lerLink(s.q.participacao.get(1),chave),null);
   db.prepare("UPDATE pessoas SET email='ana@example.com' WHERE id=1").run();
  });
  await t.test('álbum bloqueado antes do encerramento, pares e histórico depois',async()=>{
   assert.equal((await get('/admin/edicoes/1/album.pdf',admin)).status,403);
   assert.equal((await get('/c/ana/album',cookie)).status,403);
   assert.equal((await post('/admin/edicoes/1/encerrar',{confirma:'errado'},admin)).status,303);assert.equal(s.q.edicao.get(1).encerrada_em,null);
   assert.equal((await post('/admin/edicoes/1/encerrar',{confirma:'ENCERRAR',recado:'Uma roda cheia de carinho.'},admin)).status,303);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM historico_pares').get().n,3);assert.throws(()=>s.anularSorteio(1),/encerrada/);
   assert.equal((await post('/c/ana/album/recado',{csrf,texto:'Adorei nossa festa!'},cookie)).status,303);
   const previa=await (await get('/c/ana/album',cookie)).text();assert.match(previa,/Adorei nossa festa/);assert.doesNotMatch(previa,/ana@example.com|5678|SMTP_PASS/);
   const r=await get('/c/ana/album.pdf',cookie);assert.equal(r.status,200);const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.subarray(0,4).toString(),'%PDF');
   if(process.env.ALBUM_DEMO) fs.writeFileSync(process.env.ALBUM_DEMO,buf);
   assert.equal((await get('/admin/edicoes/1/backup.zip')).status,303);
   const zip=await get('/admin/edicoes/1/backup.zip',admin);assert.equal(zip.status,200);const z=Buffer.from(await zip.arrayBuffer());assert.equal(z.subarray(0,2).toString(),'PK');assert.ok(z.includes(Buffer.from('configuracao-secreta.env')));assert.ok(z.includes(Buffer.from('data/amigo-oculto.db')));
   if(process.env.BACKUP_DEMO) fs.writeFileSync(process.env.BACKUP_DEMO,z);
  });
  await t.test('criança recupera pelo e-mail verificado do responsável',async()=>{
   db.prepare('UPDATE pessoas SET responsavel_id=1 WHERE id=3').run();
   email.criarLink(s.q.participacao.get(3),'recuperar');await email.processar();
   const m=envios.at(-1);assert.equal(m.to,'ana@example.com');assert.match(m.text,/Clara/);
   const chave=tokenDoEmail(m);assert.equal((await post('/c/clara/email/'+chave,{pin:'8765',pin2:'8765'})).status,303);
   assert.ok(s.revelar(s.q.participacao.get(3),'8765').nome);
   assert.equal((await get('/c/ana/interacoes/estado',cookie)).status,200);
  });
  await t.test('falha SMTP fica incerta e não dispara reenvios duplicados',async()=>{
   let tentativas=0;smtp.createTransport=()=>({sendMail:async()=>{tentativas++;throw new Error('erro simulado');},close(){}});
   assert.ok(email.enfileirar('falha-simulada',s.q.participacao.get(1),'ana@example.com','Teste','Texto privado'));
   await email.processar();const antes=tentativas;assert.ok(antes>0);
   assert.equal(db.prepare("SELECT estado FROM fila_email WHERE id='falha-simulada'").get().estado,'incerto');
   await email.processar();assert.equal(tentativas,antes);
  });
  await t.test('formulário de outro site é recusado',async()=>{
   const r=await fetch(base+'/c/ana/dados',{method:'POST',redirect:'manual',headers:{Origin:'https://outro.example.com','Content-Type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams({nome:'Invasor',csrf})});assert.equal(r.status,403);
  });
  await t.test('sair revoga acesso em todas as áreas',async()=>{
   assert.equal((await post('/c/ana/sair',{csrf},cookie)).status,303);
   const html=await (await get('/c/ana',cookie)).text();assert.match(html,/Esqueci meu PIN/);assert.doesNotMatch(html,/raspa-premio/);
   assert.equal((await get('/c/ana/album.pdf',cookie)).status,303);
  });
 } finally {smtp.createTransport=original;await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(pasta,{recursive:true,force:true});}
});
