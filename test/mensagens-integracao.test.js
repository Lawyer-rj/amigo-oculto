'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

test('migração e painel: responsável, três canais, duplicação e falha incerta', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'amigo-canais-'));
  Object.assign(process.env, { DATA_DIR: pasta, APP_SECRET: 'teste-isolado-'.repeat(4), ADMIN_SENHA: 'teste-local', BASE_URL: 'https://familia.example.com', RESEND_API_KEY: 'fake', EMAIL_REMETENTE: 'convite@example.com', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'fake', TWILIO_SMS_FROM: '+15551234567', TWILIO_WHATSAPP_FROM: '+15551234567', TWILIO_WHATSAPP_CONVITE_SID: 'HX' + 'b'.repeat(32) });
  const antigo = new Database(path.join(pasta, 'amigo-oculto.db'));
  antigo.exec(`CREATE TABLE pessoas (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, email TEXT, foto TEXT, responsavel_id INTEGER REFERENCES pessoas(id), observacao TEXT, criado_em TEXT DEFAULT (datetime('now'))); INSERT INTO pessoas (id, nome, telefone, email) VALUES (1, 'Responsável', '21999999999', 'adulto@example.com');`);
  antigo.close();
  const { db } = require('../src/db');
  const app = require('../src/server');
  const seg = require('../src/seguranca');
  let servidor;
  const originalFetch = global.fetch;
  process.env.WA_PROVEDOR = 'twilio';
  process.env.ENVIO_POR_SERVICO = 'habilitado';
  let chamadas = 0;
  let falhar = false;
  global.fetch = async (url, req) => {
    if (String(url).startsWith('https://api.') || String(url).startsWith('https://graph.facebook.com/')) {
      chamadas++;
      if (falhar) throw new Error('falha de rede');
      if (String(url).includes('graph.facebook.com')) {
        const body = JSON.parse(req.body);
        assert.equal(body.to, '5521999999999');
        assert.equal(body.template.name, 'convite_familia');
        assert.match(body.template.components[0].parameters[1].text, /token-adulto$/);
        return { ok: true, json: async () => ({ messages: [{ id: 'wamid.fake' }] }) };
      }
      if (String(url).includes('resend')) assert.deepEqual(JSON.parse(req.body).to, ['adulto@example.com']);
      else assert.match(new URLSearchParams(req.body).get('To'), /5521999999999$/);
      return { ok: true, json: async () => ({ id: 'email-fake', sid: 'sms-fake' }) };
    }
    return originalFetch(url, req);
  };
  try {
    assert.equal(db.prepare('SELECT nome FROM pessoas WHERE id = 1').get().nome, 'Responsável');
    assert.equal(db.prepare('SELECT canal_preferido, autoriza_mensagens FROM pessoas WHERE id = 1').get().autoriza_mensagens, 0);
    db.exec(`UPDATE pessoas SET autoriza_mensagens = 1, canal_preferido = 'email' WHERE id = 1;
      INSERT INTO pessoas (id, nome, responsavel_id) VALUES (2, 'Criança', 1);
      INSERT INTO grupos (id, nome) VALUES (1, 'Família');
      INSERT INTO edicoes (id, grupo_id, nome, ano) VALUES (1, 1, 'Família 2026', 2026);
      INSERT INTO participacoes (id, edicao_id, pessoa_id, token) VALUES (1, 1, 2, 'token-da-crianca');`);
    servidor = await new Promise((resolve, reject) => { const http = app.listen(0, '127.0.0.1', () => resolve(http)); http.once('error', reject); });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const cookie = `ao_admin=${seg.assinarSessao()}`;
    const enviar = (canal, modo = 'servico', auth = true) => originalFetch(base + '/admin/edicoes/1/mensagens/1', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(auth ? { cookie } : {}) }, body: new URLSearchParams({ canal, modo }) });
    assert.equal((await enviar('email', 'servico', false)).status, 401);
    assert.equal(chamadas, 0);
    process.env.ENVIO_POR_SERVICO = 'desativado';
    const semServico = await enviar('email');
    assert.match(decodeURIComponent(semServico.headers.get('location')), /desativado/);
    assert.equal(chamadas, 0);
    const painelGratis = await (await originalFetch(base + '/admin/edicoes/1', { headers: { cookie } })).text();
    assert.doesNotMatch(painelGratis, /Enviar pelo serviço/);
    assert.match(painelGratis, /Abrir mensagem/);
    process.env.ENVIO_POR_SERVICO = 'habilitado';
    const pagina = await (await originalFetch(base + '/admin/edicoes/1', { headers: { cookie } })).text();
    assert.match(pagina, /value="email" selected/);
    assert.match(pagina, /Entreg|entreg/);
    for (const canal of ['whatsapp', 'sms', 'email']) {
      const manual = await enviar(canal, 'manual');
      assert.equal(manual.status, 200);
      assert.match(await manual.text(), /Responsável/);
      const resposta = await enviar(canal);
      assert.match(decodeURIComponent(resposta.headers.get('location')), /aceita pelo serviço/);
      await enviar(canal);
    }
    assert.equal(chamadas, 3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mensagens').get().n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mensagens WHERE estado = ?').get('aceito').n, 3);
    db.exec("INSERT INTO participacoes (id, edicao_id, pessoa_id, token) VALUES (2, 1, 1, 'token-adulto')");
    falhar = true;
    const reqFalha = () => originalFetch(base + '/admin/edicoes/1/mensagens/2', { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'canal=sms&modo=servico' });
    await reqFalha(); await reqFalha();
    assert.equal(chamadas, 4);
    assert.equal(db.prepare("SELECT estado FROM mensagens WHERE participacao_id = 2").get().estado, 'incerto');
    falhar = false;
    Object.assign(process.env, { WA_PROVEDOR: 'meta', WA_API_TOKEN: 'fake', WA_PHONE_NUMBER_ID: '123456789', WA_GRAPH_VERSION: 'v26.0', WA_TEMPLATE_CONVITE: 'convite_familia' });
    const enviarMeta = () => originalFetch(base + '/admin/edicoes/1/mensagens/2', { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'canal=whatsapp&modo=servico' });
    const respostaMeta = await enviarMeta();
    assert.match(decodeURIComponent(respostaMeta.headers.get('location')), /aceita pelo serviço/);
    await enviarMeta();
    assert.equal(chamadas, 5);
    assert.equal(db.prepare("SELECT servico_id FROM mensagens WHERE participacao_id = 2 AND canal = 'whatsapp'").get().servico_id, 'wamid.fake');
  } finally {
    global.fetch = originalFetch;
    if (servidor) await new Promise((resolve) => servidor.close(resolve));
    db.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
