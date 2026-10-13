'use strict';
// Carga inicial: grupo, participantes e a edição 2026.
// Só roda se o banco estiver vazio. Uso: node scripts/carga-inicial.js
const { db, log } = require('../src/db');
const s = require('../src/servico');

if (db.prepare('SELECT COUNT(*) n FROM grupos').get().n > 0) {
  console.log('O banco já tem dados; carga inicial ignorada.');
  process.exit(0);
}

// Os nomes ficam em scripts/participantes.json (fora do Git, por privacidade).
// Modelo: scripts/participantes.exemplo.json
const fs = require('fs');
const path = require('path');
const arq = path.join(__dirname, 'participantes.json');
if (!fs.existsSync(arq)) {
  console.log('Arquivo scripts/participantes.json não encontrado. Copie participantes.exemplo.json e preencha.');
  process.exit(1);
}
const lista = JSON.parse(fs.readFileSync(arq, 'utf8'));
const nucleos = lista.nucleos.map((n) => [n.nome, n.pessoas]);

db.transaction(() => {
  const grupo = db.prepare('INSERT INTO grupos (nome) VALUES (?)').run(lista.grupo || 'Família').lastInsertRowid;
  const insP = db.prepare('INSERT INTO pessoas (nome) VALUES (?)');
  const insM = db.prepare('INSERT INTO grupo_membros (grupo_id, pessoa_id, nucleo) VALUES (?, ?, ?)');
  let n = 0;
  for (const [nucleo, nomes] of nucleos) {
    for (const nome of nomes) {
      insM.run(grupo, insP.run(nome).lastInsertRowid, nucleo);
      n++;
    }
  }
  const ed = db.prepare(`INSERT INTO edicoes (grupo_id, nome, ano, sorteio_em, entrega_em, entrega_local, mensagem)
    VALUES (?, 'Amigo Oculto 2026', 2026, ?, ?, NULL, ?)`).run(
    grupo,
    s.deCampoLocal('2026-12-24T12:00'),
    s.deCampoLocal('2026-12-31T21:00'),
    'A entrega será na confraternização de Réveillon. Quem receber o presente revela o próximo, até a roda se fechar!',
  ).lastInsertRowid;
  s.incluirGrupoInteiro(ed);
  log(ed, `Carga inicial: ${n} pessoas do grupo Família.`);
  console.log(`Carga inicial concluída: ${n} pessoas, edição ${ed}.`);
})();
