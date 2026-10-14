'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('fluxo gratuito e proteção do sorteio', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'amigo-gratuito-'));
  Object.assign(process.env, { DATA_DIR: pasta, APP_SECRET: 'teste-gratuito-'.repeat(4), ADMIN_SENHA: 'teste', BASE_URL: 'https://familia.example.com' });
  delete process.env.ENVIO_POR_SERVICO;
  const { db } = require('../src/db');
  const seg = require('../src/seguranca');
  const s = require('../src/servico');
  const app = require('../src/server');
  db.exec(`INSERT INTO grupos (id, nome) VALUES (1, 'Família');
    INSERT INTO edicoes (id, grupo_id, nome, ano, sorteio_em) VALUES (1, 1, 'Família 2026', 2026, '2020-01-01T00:00:00.000Z');
    INSERT INTO pessoas (id, nome, telefone, email) VALUES (1, 'Ana', '21999999999', 'ana@example.com'), (2, 'Bruno', '21999999998', 'bruno@example.com'), (3, 'Clara', '21999999997', 'clara@example.com');
    INSERT INTO participacoes (id, edicao_id, pessoa_id, token) VALUES (1, 1, 1, 'ana-token'), (2, 1, 2, 'bruno-token'), (3, 1, 3, 'clara-token');`);
  const servidor = await new Promise((resolve, reject) => { const http = app.listen(0, '127.0.0.1', () => resolve(http)); http.once('error', reject); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cookie = `ao_admin=${seg.assinarSessao()}`;
  const post = (url, body, admin = false) => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(admin ? { cookie } : {}) }, body: new URLSearchParams(body) });

  try {
    await t.test('confirmação inicia sessão sem código longo e mantém sugestões detalhadas', async () => {
      for (const token of ['ana-token', 'bruno-token', 'clara-token']) {
        const r = await post(`/c/${token}/confirmar`, { resposta: 'confirmado', pin: '1234', pin2: '1234' });
        assert.equal(r.status, 303);
        assert.match(r.headers.get('set-cookie'), /Max-Age=86400/);
      }
      assert.equal(db.prepare('SELECT pin_recuperacao_hash FROM participacoes WHERE id = 1').get().pin_recuperacao_hash, null);
      await post('/c/ana-token/sugestoes', { pin_atual: '1234', texto0: 'Camisa', onde0: 'Loja física', cor0: 'Azul', tamanho0: 'M', detalhes0: 'Algodão', link0: 'https://loja.example.com/camisa' });
      const sug = db.prepare('SELECT * FROM sugestoes WHERE participacao_id = 1').get();
      assert.equal(sug.onde, 'Loja física'); assert.equal(sug.cor, 'Azul'); assert.equal(sug.tamanho, 'M'); assert.equal(sug.detalhes, 'Algodão');
      const painel = await (await fetch(base + '/admin/edicoes/1', { headers: { cookie } })).text();
      assert.doesNotMatch(painel, /Enviar pelo serviço/);

    });
    await t.test('PIN do sorteio não pode ser apagado pelo organizador', async () => {
      s.executarSorteio(1);
      const r = await post('/admin/edicoes/1/participacoes/1/resetar-pin', {}, true);
      assert.match(decodeURIComponent(r.headers.get('location')), /só o participante/);
      assert.ok(db.prepare('SELECT pin_hash FROM participacoes WHERE id = 1').get().pin_hash);
      const resultado = s.revelar(s.q.participacao.get(1), '1234');
      assert.ok(resultado.nome);
    });
    await t.test('recuperação não simula envio sem remetente configurado', async () => {
      const pedido = await post('/c/ana-token/esqueci-pin', {});
      assert.equal(pedido.status, 303);
      assert.match(decodeURIComponent(pedido.headers.get('location')), /ainda não foi configurado/);
      assert.ok(s.revelar(s.q.participacao.get(1), '1234').nome);
    });
    await t.test('grupo inteiro não pode ser incluído após sorteio', async () => {
      db.exec("INSERT INTO pessoas (id, nome) VALUES (4, 'Daniel'); INSERT INTO grupo_membros (grupo_id, pessoa_id) VALUES (1, 4)");
      const r = await post('/admin/edicoes/1/incluir-grupo', {}, true);
      assert.match(decodeURIComponent(r.headers.get('location')), /já sorteada/);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM participacoes WHERE edicao_id = 1').get().n, 3);
    });
    await t.test('anulação suspende a data vencida e não refaz o sorteio', () => {
      s.anularSorteio(1);
      assert.equal(s.q.edicao.get(1).sorteio_em, null);
      s.verificarAgendados();
      assert.equal(s.q.edicao.get(1).status, 'aberta');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM pares WHERE edicao_id = 1').get().n, 0);
    });
    await t.test('histórico ignora uma edição futura', () => {
      db.exec("INSERT INTO edicoes (id, grupo_id, nome, ano) VALUES (2, 1, 'Família 2027', 2027)");
      for (const id of [1, 2, 3]) {
        db.prepare("INSERT INTO participacoes (edicao_id, pessoa_id, token, status, pin_hash) VALUES (2, ?, ?, 'confirmado', ?)").run(id, `futuro-${id}`, seg.hashPin('1234'));
      }
      s.executarSorteio(2);
      assert.equal(s.simular(1).historico, 0);
    });
  } finally {
    await new Promise((resolve) => servidor.close(resolve)); db.close();
    assert.ok(path.resolve(pasta).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
