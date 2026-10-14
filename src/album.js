'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { db, DATA_DIR, log } = require('./db');
const seg = require('./seguranca');
const s = require('./servico');
const historico = require('./historico');
const {h,avatar} = require('./layout');
db.exec(`CREATE TABLE IF NOT EXISTS album_recados (participacao_id INTEGER PRIMARY KEY REFERENCES participacoes(id) ON DELETE CASCADE, texto TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS album_fotos (id INTEGER PRIMARY KEY, edicao_id INTEGER NOT NULL REFERENCES edicoes(id), arquivo TEXT NOT NULL, legenda TEXT);`);
function dados(e) {
 if(!e.encerrada_em) throw new Error('Encerre a edição após a troca de presentes para revelar o álbum.');
 const parts=db.prepare('SELECT p.id,pe.nome,pe.foto,p.presente_comprado_em FROM participacoes p JOIN pessoas pe ON pe.id=p.pessoa_id JOIN pares pa ON pa.participacao_id=p.id WHERE p.edicao_id=? ORDER BY alfa(pe.nome)').all(e.id);
 const pares=db.prepare('SELECT * FROM pares WHERE edicao_id=?').all(e.id).map(x=>({de:s.q.participacao.get(x.participacao_id).nome,para:s.q.participacao.get(Number(seg.decifrar(x.destino_cifrado,x.participacao_id))).nome})).sort((a,b)=>a.de.localeCompare(b.de,'pt-BR'));
 const recados=db.prepare('SELECT pe.nome,r.texto FROM album_recados r JOIN participacoes p ON p.id=r.participacao_id JOIN pessoas pe ON pe.id=p.pessoa_id WHERE p.edicao_id=? ORDER BY alfa(pe.nome)').all(e.id);
 const fotos=db.prepare('SELECT * FROM album_fotos WHERE edicao_id=? ORDER BY id').all(e.id);
 const sugestoes=db.prepare('SELECT COUNT(*) n FROM sugestoes sg JOIN participacoes p ON p.id=sg.participacao_id JOIN pares pa ON pa.participacao_id=p.id WHERE p.edicao_id=?').get(e.id).n;
 return {e,parts,pares,recados,fotos,sugestoes,anos:historico.anos(e.grupo_id).filter(x=>x.ano<e.ano)};
}
function imagem(nome) {
 if(!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(nome||'')) return null;
 const arquivo=path.join(DATA_DIR,'fotos',nome); return fs.existsSync(arquivo)?arquivo:null;
}
function previa(d) {
 return `<section class="cartao"><span class="etiqueta">Uma lembrança da nossa roda</span><h2>${h(d.e.nome)}</h2><p>${h(s.formatar(d.e.entrega_em))} · ${h(d.e.entrega_local||'Nossa confraternização')}</p><p>${h(d.e.album_recado||'O melhor presente foi estarmos juntos.')}</p><div class="fatos"><div class="fato"><b>Pessoas na roda</b><span>${d.parts.length}</span></div><div class="fato"><b>Ideias de presentes</b><span>${d.sugestoes}</span></div><div class="fato"><b>Compras marcadas</b><span>${d.parts.filter(p=>p.presente_comprado_em).length}</span></div></div></section><section class="cartao"><h2>Quem fez parte</h2><div class="album-pessoas">${d.parts.map(p=>`<div>${avatar(p.foto,p.nome,'ini')} ${h(p.nome)}</div>`).join('')}</div></section><section class="cartao"><h2>A roda das surpresas</h2><div class="rolagem"><table><tr><th>Quem presenteou</th><th>Quem recebeu</th></tr>${d.pares.map(p=>`<tr><td>${h(p.de)}</td><td>${h(p.para)}</td></tr>`).join('')}</table></div></section>${d.recados.length?`<section class="cartao"><h2>Recados para guardar</h2>${d.recados.map(r=>`<blockquote><p>${h(r.texto)}</p><b>${h(r.nome)}</b></blockquote>`).join('')}</section>`:''}${d.fotos.map(f=>{const a=imagem(f.arquivo);return a?`<section class="cartao"><img class="album-foto" src="data:image/${f.arquivo.endsWith('png')?'png':'jpeg'};base64,${fs.readFileSync(a).toString('base64')}" alt="${h(f.legenda||'Foto do encontro')}"><p>${h(f.legenda||'')}</p></section>`:'';}).join('')}${d.anos.map(a=>`<section class="cartao"><h2>Lembranças de ${a.ano}</h2>${historico.pares(a.id).map(p=>`<p>${h(p.de_nome)} presenteou ${h(p.para_nome)}</p>`).join('')}</section>`).join('')}`;
}
function encerrar(e,recado) {
 if(e.status!=='sorteada') throw new Error('Faça o sorteio e a troca de presentes antes de encerrar.');
 if(e.encerrada_em) return;
 db.transaction(()=>{
  const existente=db.prepare('SELECT id FROM historico_anos WHERE grupo_id=? AND ano=?').get(e.grupo_id,e.ano);
  if(existente && historico.pares(existente.id).length) throw new Error('Este ano já possui histórico registrado. Confira os dados antes de encerrar.');
  db.prepare('INSERT OR IGNORE INTO historico_anos (grupo_id,ano) VALUES (?,?)').run(e.grupo_id,e.ano);
  const a=db.prepare('SELECT id FROM historico_anos WHERE grupo_id=? AND ano=?').get(e.grupo_id,e.ano);
  for(const p of db.prepare('SELECT * FROM pares WHERE edicao_id=?').all(e.id)) {
   const de=s.q.participacao.get(p.participacao_id),para=s.q.participacao.get(Number(seg.decifrar(p.destino_cifrado,p.participacao_id)));
   db.prepare('INSERT INTO historico_pares (historico_id,de_id,para_id) VALUES (?,?,?)').run(a.id,de.pessoa_id,para.pessoa_id);
  }
  db.prepare('UPDATE edicoes SET encerrada_em=?,album_recado=? WHERE id=?').run(s.agoraISO(),String(recado||'').trim().slice(0,600),e.id);
  log(e.id,'Edição encerrada após a troca; pares publicados no histórico e álbum.');
 })();
}
function pdf(d,saida) {
 const doc=new PDFDocument({size:'A4',margin:48,bufferPages:true,info:{Title:d.e.nome,Author:'Amigo Oculto da Família'}});
 doc.pipe(saida);
 const plum='#46283f',pink='#c15b88',mint='#e7f1e9';
 function titulo(t) {doc.fillColor(plum).font('Helvetica-Bold').fontSize(24).text(t);doc.moveDown(.7);}
 function texto(t) {doc.fillColor(plum).font('Helvetica').fontSize(12).text(t,{lineGap:5});doc.moveDown(.5);}
 function foto(nome,x,y,w,h) {const a=imagem(nome);if(!a || nome.endsWith('webp')) return false;try{doc.image(a,x,y,{fit:[w,h],align:'center',valign:'center'});return true;}catch{return false;}}
 doc.rect(0,0,doc.page.width,doc.page.height).fill('#faf4f7');
 doc.fillColor(pink).fontSize(11).text('UMA LEMBRANÇA DA NOSSA RODA',48,105);
 doc.fillColor(plum).font('Helvetica-Bold').fontSize(42).text(d.e.nome,48,150,{width:490});
 doc.y=Math.max(doc.y+30,300);texto(d.e.album_recado||'O melhor presente foi estarmos juntos.');
 texto(`${s.formatar(d.e.entrega_em)}${d.e.entrega_local?' · '+d.e.entrega_local:''}`);
 doc.roundedRect(48,570,499,110,16).fill(mint);
 doc.fillColor(plum).font('Helvetica-Bold').fontSize(20).text(`${d.parts.length} pessoas · ${d.sugestoes} ideias`,70,597,{width:455});
 doc.font('Helvetica').fontSize(12).text(`${d.parts.filter(p=>p.presente_comprado_em).length} compras marcadas no aplicativo. Uma roda cheia de carinho.`,70,633,{width:455});
 doc.addPage();titulo('Quem fez parte');
 for(const p of d.parts) {if(doc.y>720) {doc.addPage();titulo('Nossa família');}const y=doc.y;doc.roundedRect(48,y,499,56,8).fill('#faf4f7');const tem=foto(p.foto,58,y+5,46,46);doc.fillColor(plum).font('Helvetica-Bold').fontSize(13).text(p.nome,tem?118:66,y+18,{width:tem?412:462});doc.y=y+67;}
 doc.addPage();titulo('A roda das surpresas');texto('Depois dos segredos, as boas lembranças:');
 for(const p of d.pares) {if(doc.y>710){doc.addPage();titulo('A roda continua');}texto(`${p.de} presenteou ${p.para}.`);}
 if(d.recados.length) {doc.addPage();titulo('Recados para guardar');for(const r of d.recados){if(doc.y>650){doc.addPage();titulo('Mais carinho');}texto(r.texto);doc.font('Helvetica-Bold').text(r.nome);doc.moveDown();}}
 for(const f of d.fotos){doc.addPage();titulo('Nosso encontro');if(foto(f.arquivo,48,110,499,550)){doc.y=680;texto(f.legenda||'Um momento para guardar.');}}
 for(const a of d.anos){doc.addPage();titulo(`Lembranças de ${a.ano}`);for(const p of historico.pares(a.id)){if(doc.y>710){doc.addPage();titulo(`A roda de ${a.ano}`);}texto(`${p.de_nome} presenteou ${p.para_nome}.`);}}
 const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);doc.fillColor(pink).font('Helvetica').fontSize(9).text(`Amigo Oculto da Família · ${i+1} / ${range.count}`,48,790,{lineBreak:false});}
 doc.end(); return doc;
}
async function backup(saida) {
 const {ZipArchive}=require('archiver');
 const temporario=path.join(DATA_DIR,`backup-${crypto.randomUUID()}.db`);
 await db.backup(temporario);
 const archive=new ZipArchive({zlib:{level:6}});
 const limpar=()=>fs.rm(temporario,{force:true},()=>{});
 archive.on('error',err=>{limpar();saida.destroy(err);});saida.on('close',limpar);
 archive.pipe(saida);archive.file(temporario,{name:'data/amigo-oculto.db'});archive.directory(path.join(DATA_DIR,'fotos'),'data/fotos');
 archive.append(`APP_SECRET=${process.env.APP_SECRET}\n`,{name:'configuracao-secreta.env'});
 archive.append('BACKUP PRIVADO - NAO COMPARTILHAR\nInclui todos os cadastros, conversas, fotos e histórico do aplicativo.\nPara restaurar: pare o aplicativo, substitua o banco e as fotos em /data e configure APP_SECRET usando configuracao-secreta.env. Configure separadamente senha do organizador, BASE_URL e SMTP. Use a mesma versão do aplicativo.\n',{name:'COMO-RESTAURAR.txt'});
 await archive.finalize();
}
module.exports={dados,previa,encerrar,pdf,backup,imagem};
