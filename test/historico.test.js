'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
test('histórico anterior aceita cadastro parcial e orienta o sorteio', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'amigo-historico-'));
  process.env.DATA_DIR = pasta; process.env.APP_SECRET = 'teste-historico-'.repeat(4);
  const { db } = require('../src/db');
  const hist = require('../src/historico'); const seg = require('../src/seguranca'); const s = require('../src/servico');
  try {
    db.exec("INSERT INTO grupos (id, nome) VALUES (1, 'Família'); INSERT INTO pessoas (id, nome) VALUES (1, 'Ana'), (2, 'Bruno'), (3, 'Clara'); INSERT INTO edicoes (id, grupo_id, nome, ano) VALUES (1, 1, 'Atual', 2026)");
    for (const id of [1, 2, 3]) db.prepare("INSERT INTO participacoes (id, edicao_id, pessoa_id, token, status, pin_hash) VALUES (?, 1, ?, ?, 'confirmado', ?)").run(id, id, 'token-' + id, seg.hashPin('1234'));
    hist.registrar(1, 2024, 1, 3);
    const ano = hist.registrar(1, 2025, 1, 2);
    assert.equal(hist.pares(ano).length, 1);
    hist.registrar(1, 2025, 1, 2); assert.equal(hist.pares(ano).length, 1);
    assert.throws(() => hist.registrar(1, 2025, 3, 2), /já aparece/);
    assert.equal(hist.pares(ano).length, 1);
    assert.throws(() => hist.registrar(1, 2025, 2, 2));
    assert.throws(() => hist.registrar(1, 2099, 1, 2));
    assert.equal(s.simular(1).historico, 1);
    assert.equal(s.simular(1).repeticoes, 0);
    assert.match(hist.mostrar(1, 2026), /A roda de 2025/);
    assert.match(hist.mostrar(1, 2026), /Ana/);
    assert.equal(hist.anos(1, 2025).length, 1);
    s.executarSorteio(1);
    const par = db.prepare('SELECT destino_cifrado FROM pares WHERE participacao_id = 1').get();
    assert.notEqual(Number(seg.decifrar(par.destino_cifrado, 1)), 2);
  } finally { db.close(); assert.ok(path.resolve(pasta).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(pasta, { recursive: true, force: true }); }
});
