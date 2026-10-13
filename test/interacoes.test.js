'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('compras, mural, conversas privadas e anonimato', async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'amigo-social-'));
  Object.assign(process.env, { DATA_DIR: pasta, APP_SECRET: 'teste-interacoes-'.repeat(4), BASE_URL: 'http://localhost:3000', ADMIN_SENHA: 'teste' });
  const { db } = require('../src/db');
  const seg = require('../src/seguranca');
  const s = require('../src/servico');
  const app = require('../src/server');
  db.exec(`INSERT INTO grupos (id, nome) VALUES (1, 'Família');
    INSERT INTO edicoes (id, grupo_id, nome, ano) VALUES (1, 1, 'Edição 2026', 2026), (2, 1, 'Outro grupo', 2027);`);
  for (const [id, nome, edicao] of [[1, 'Ana', 1], [2, 'Bruno', 1], [3, 'Clara', 1], [4, 'Pessoa de outra edição', 2]]) {
    db.prepare('INSERT INTO pessoas (id, nome) VALUES (?, ?)').run(id, nome);
    db.prepare("INSERT INTO participacoes (id, edicao_id, pessoa_id, token, status, pin_hash) VALUES (?, ?, ?, ?, 'confirmado', ?)").run(id, edicao, id, `token-${id}`, seg.hashPin('1234'));
  }
  db.exec('UPDATE pessoas SET responsavel_id = 1 WHERE id = 3');
  const servidor = await new Promise((resolve, reject) => { const http = app.listen(0, '127.0.0.1', () => resolve(http)); http.once('error', reject); });
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const perfis = {};
  const endpoint = (id, suffix = '') => `${url}/c/token-${id}/interacoes${suffix}`;
  const post = (id, suffix, body = {}, auth = true) => fetch(endpoint(id, suffix), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(auth && perfis[id] ? { cookie: perfis[id].cookie } : {}) }, body: new URLSearchParams({ ...(auth && perfis[id] ? { csrf: perfis[id].csrf } : {}), ...body }) });
  const estado = (id, conversa = '') => fetch(endpoint(id, '/estado' + (conversa ? `?conversa=${conversa}` : '')), { redirect: 'manual', headers: { cookie: perfis[id].cookie } });
  let privada, anonima, receptor;
  try {
    await t.test('exige PIN, bloqueia cinco erros e emite cookies protegidos', async () => {
      const livre = await fetch(endpoint(1)); assert.doesNotMatch(await livre.text(), /social-mensagens/);
      for (let k = 0; k < 5; k++) await post(3, '/entrar', { pin: '0000' }, false);
      const bloqueio = await post(3, '/entrar', { pin: '1234' }, false);
      assert.match(decodeURIComponent(bloqueio.headers.get('location')), /15 minutos/);
      db.prepare('UPDATE participacoes SET pin_bloqueio_ate = NULL, pin_tentativas = 0 WHERE id = 3').run();
      for (const id of [1, 2, 3, 4]) {
        const r = await post(id, '/entrar', { pin: '1234' }, false);
        assert.equal(r.status, 303);
        assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
        const cookie = r.headers.get('set-cookie').split(';')[0];
        const html = await (await fetch(endpoint(id), { headers: { cookie } })).text();
        perfis[id] = { cookie, csrf: html.match(/name="csrf" value="([^"]+)"/)[1] };
      }
      const semPin = await fetch(endpoint(1, '/estado'), { redirect: 'manual' });
      assert.equal(semPin.status, 401);
      assert.ok(!JSON.stringify(db.prepare('SELECT * FROM sessoes_pessoas').all()).includes(perfis[1].cookie.split('=')[1]));
    });
    await t.test('mural escapa conteúdo e só o autor pode apagar', async () => {
      const semCsrf = await post(1, '/mensagem', { texto: 'sem autorização', csrf: '' }); assert.equal(semCsrf.status, 403);
      assert.equal((await post(1, '/mensagem', { texto: '<script>alert(1)</script> Olá família!' })).status, 303);
      const dados = await (await estado(2)).json();
      assert.equal(dados.mensagens[0].autor, 'Ana');
      const html = await (await fetch(endpoint(2), { headers: { cookie: perfis[2].cookie } })).text();
      assert.ok(!html.includes('<script>alert(1)</script>')); assert.ok(html.includes('&lt;script&gt;'));
      assert.equal((await post(2, '/apagar', { mensagem: dados.mensagens[0].id })).status, 403);
      assert.equal((await post(1, '/apagar', { mensagem: dados.mensagens[0].id })).status, 303);
      assert.equal((await (await estado(4)).json()).mensagens.length, 0);
    });
    await t.test('criança tem perfil separado e alterações de cadastro exigem acesso', async () => {
      const paginaCrianca = await (await fetch(url + '/c/token-3', { headers: { cookie: perfis[3].cookie } })).text();
      assert.match(paginaCrianca, /sob responsabilidade de Ana/);
      assert.notEqual(perfis[1].cookie, perfis[3].cookie);
      const semPin = await fetch(url + '/c/token-1/dados', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'nome=Invasor' });
      assert.equal(semPin.status, 303);
      assert.equal(db.prepare('SELECT nome FROM pessoas WHERE id = 1').get().nome, 'Ana');
      const permitido = await fetch(url + '/c/token-1/dados', { method: 'POST', redirect: 'manual', headers: { cookie: perfis[1].cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ nome: 'Ana', email: 'ana@example.com', csrf: perfis[1].csrf }) });
      assert.equal(permitido.status, 303);
      assert.equal(db.prepare('SELECT email FROM pessoas WHERE id = 1').get().email, 'ana@example.com');
    });
    await t.test('privada é acessível às duas pessoas e não a terceiros', async () => {
      const r = await post(1, '/privada', { pessoa: '2' });
      privada = r.headers.get('location').split('conversa=')[1]; assert.ok(privada);
      assert.equal((await post(1, '/mensagem', { conversa: privada, texto: 'Mensagem privada de teste' })).status, 303);
      assert.equal((await (await estado(2, privada)).json()).mensagens[0].texto, 'Mensagem privada de teste');
      assert.equal((await estado(3, privada)).status, 404);
      assert.equal((await estado(4, privada)).status, 404);
      assert.equal((await post(3, '/mensagem', { conversa: privada, texto: 'intrusão' })).status, 404);
      const novamente = await post(2, '/privada', { pessoa: '1' }); assert.equal(novamente.headers.get('location').split('conversa=')[1], privada);
      const outraEdicao = await post(1, '/privada', { pessoa: '4' }); assert.ok(!outraEdicao.headers.get('location').includes('conversa='));
    });
    await t.test('compra só depois do sorteio, visível sem destinatário', async () => {
      await post(1, '/compra', { comprado: '1' }); assert.equal(db.prepare('SELECT presente_comprado_em FROM participacoes WHERE id = 1').get().presente_comprado_em, null);
      s.executarSorteio(1);
      await post(1, '/compra', { comprado: '1' });
      const dados = await (await estado(2)).json();
      assert.deepEqual(Object.keys(dados.compras[0]).sort(), ['comprado', 'id', 'nome']);
      assert.equal(dados.compras.find((x) => x.id === 1).comprado, true);
      await post(1, '/compra', { comprado: '0' }); assert.equal((await (await estado(2)).json()).compras.find((x) => x.id === 1).comprado, false);
      await post(1, '/compra', { comprado: '1' });
    });
    await t.test('conversa anônima oculta autor, cifra os vínculos e aceita resposta', async () => {
      await fetch(endpoint(1), { headers: { cookie: perfis[1].cookie } });
      const conversas = db.prepare("SELECT * FROM conversas WHERE tipo = 'anonima'").all();
      const c = conversas.find((x) => JSON.parse(seg.decifrar(x.vinculos_cifrados, `conversa:${x.id}`))[0] === 1);
      anonima = c.id; receptor = JSON.parse(seg.decifrar(c.vinculos_cifrados, `conversa:${c.id}`))[1];
      await post(1, '/mensagem', { conversa: anonima, texto: 'Você prefere azul ou verde?' });
      const dados = await (await estado(receptor, anonima)).json();
      assert.equal(dados.mensagens[0].autor, 'Seu amigo oculto');
      assert.equal(dados.mensagens[0].texto, 'Você prefere azul ou verde?');
      assert.deepEqual(Object.keys(dados.mensagens[0]).sort(), ['autor', 'em', 'id', 'minha', 'texto']);
      assert.ok(!JSON.stringify(dados.mensagens).includes('Ana'));
      assert.ok(!JSON.stringify(dados).includes('token-'));
      await post(receptor, '/mensagem', { conversa: anonima, texto: 'Prefiro azul!' });
      const resposta = await (await estado(1, anonima)).json(); assert.equal(resposta.mensagens[1].autor, 'Seu amigo sorteado');
      const terceiro = [1, 2, 3].find((x) => x !== 1 && x !== receptor); assert.equal((await estado(terceiro, anonima)).status, 404);
      const banco = JSON.stringify(db.prepare('SELECT * FROM mensagens_interacao').all()); assert.ok(!banco.includes('Prefiro azul')); assert.ok(!banco.includes('Mensagem privada de teste'));
    });
    await t.test('anulação limpa compras e invalida conversa anônima antiga', async () => {
      s.anularSorteio(1);
      assert.equal((await estado(1, anonima)).status, 404);
      assert.equal(db.prepare('SELECT presente_comprado_em FROM participacoes WHERE id = 1').get().presente_comprado_em, null);
      s.executarSorteio(1);
      assert.equal((await estado(1, anonima)).status, 404);
      assert.equal((await estado(1, privada)).status, 200);
    });
    await t.test('troca do PIN revoga a sessão, e sair também', async () => {
      db.prepare('UPDATE participacoes SET pin_hash = ? WHERE id = 1').run(seg.hashPin('5678'));
      assert.equal((await estado(1)).status, 401);
      await post(2, '/sair'); assert.equal((await estado(2)).status, 401);
    });
    await t.test('limita mensagens em sequência e rejeita textos grandes', async () => {
      assert.equal((await post(4, '/mensagem', { texto: 'x'.repeat(1001) })).status, 303);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM mensagens_interacao WHERE edicao_id = 2').get().n, 0);
      for (let k = 0; k < 5; k++) assert.equal((await post(4, '/mensagem', { texto: `Mensagem ${k}` })).status, 303);
      assert.equal((await post(4, '/mensagem', { texto: 'Mensagem demais' })).status, 429);
    });
  } finally {
    await new Promise((resolve) => servidor.close(resolve)); db.close();
    assert.ok(path.resolve(pasta).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(pasta, { recursive: true, force: true });
  }
});
