'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/mensagens');
const edicao = { id: 1, nome: 'Família 2026', status: 'aberta' };
const participante = { id: 5, nome: 'Criança', token: 'link-pessoal' };
const destinatario = { nome: 'Responsável', telefone: '(21) 99999-9999', email: 'responsavel@example.com', autoriza_mensagens: 1 };
const env = { RESEND_API_KEY: 'teste', EMAIL_REMETENTE: 'Familia <convite@example.com>', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'teste', TWILIO_SMS_FROM: '+15551234567', TWILIO_WHATSAPP_FROM: 'whatsapp:+15551234567', TWILIO_WHATSAPP_CONVITE_SID: 'HX' + 'b'.repeat(32), TWILIO_WHATSAPP_RESULTADO_SID: 'HX' + 'c'.repeat(32) };
const preparar = (canal, e = edicao) => m.preparar({ edicao: e, participante, destinatario, canal, baseUrl: 'https://familia.example.com' });

test('três canais preservam o cadastro da criança e usam contato do responsável', () => {
  for (const canal of m.CANAIS) {
    const msg = preparar(canal);
    assert.match(msg.texto, /Responsável/);
    assert.match(msg.texto, /Criança/);
    assert.match(msg.texto, /três sugestões/);
    assert.match(msg.link, /\/c\/link-pessoal$/);
    assert.match(m.linkManual(msg), canal === 'email' ? /^mailto:/ : canal === 'sms' ? /^sms:/ : /^https:\/\/wa.me\//);
    m.validarAutomatico(msg, destinatario, env);
  }
  assert.equal(preparar('email').destino, destinatario.email);
  assert.equal(preparar('sms').destino, '+5521999999999');
});

test('aviso do resultado envia somente o link e pede PIN', () => {
  const msg = preparar('email', { ...edicao, status: 'sorteada', sorteado_em: '2026-12-24' });
  assert.equal(msg.tipo, 'resultado');
  assert.match(msg.texto, /PIN/);
  assert.doesNotMatch(msg.texto, /amigo oculto é/);
});

test('valida canal, contatos, configuração, autorização e endereço público', () => {
  assert.throws(() => preparar('fax'), /Escolha/);
  assert.throws(() => m.telefone('abc'), /telefone/);
  assert.throws(() => m.preparar({ edicao, participante, destinatario: { ...destinatario, email: 'invalido' }, canal: 'email', baseUrl: 'https://familia.example.com' }), /e-mail válido/);
  assert.throws(() => m.validarAutomatico(preparar('email'), { ...destinatario, autoriza_mensagens: 0 }, env), /autorização/);
  assert.throws(() => m.validarAutomatico(preparar('email'), destinatario, {}), /RESEND/);
  const local = m.preparar({ edicao, participante, destinatario, canal: 'sms', baseUrl: 'http://localhost:3000' });
  assert.throws(() => m.validarAutomatico(local, destinatario, env), /HTTPS/);
  assert.throws(() => m.validarAutomatico(preparar('whatsapp'), destinatario, { ...env, TWILIO_WHATSAPP_CONVITE_SID: '' }), /modelo aprovado/);
});

test('e-mail usa chave de idempotência e texto individual', async () => {
  const result = await m.enviar(preparar('email'), 'chave', { env, fetchImpl: async (url, req) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(req.headers['Idempotency-Key'], 'chave');
    const body = JSON.parse(req.body);
    assert.deepEqual(body.to, [destinatario.email]);
    assert.match(body.text, /link-pessoal/);
    return { ok: true, json: async () => ({ id: 'email-teste' }) };
  } });
  assert.deepEqual(result, { id: 'email-teste', estado: 'aceito' });
});

test('SMS e WhatsApp usam remetentes e modelos corretos', async () => {
  for (const canal of ['sms', 'whatsapp']) {
    await m.enviar(preparar(canal), 'chave', { env, fetchImpl: async (url, req) => {
      assert.match(url, /^https:\/\/api.twilio.com\//);
      const body = new URLSearchParams(req.body);
      assert.equal(body.get('To'), canal === 'sms' ? '+5521999999999' : 'whatsapp:+5521999999999');
      if (canal === 'sms') assert.match(body.get('Body'), /link-pessoal/);
      else {
        assert.equal(body.get('ContentSid'), env.TWILIO_WHATSAPP_CONVITE_SID);
        assert.equal(JSON.parse(body.get('ContentVariables'))['1'], 'Criança');
        assert.equal(body.get('Body'), null);
      }
      return { ok: true, json: async () => ({ sid: 'SM-teste' }) };
    } });
  }
});

test('falhas e resultados incertos não expõem respostas nem credenciais', async () => {
  for (const status of [400, 401, 429, 500]) {
    await assert.rejects(m.enviar(preparar('email'), 'x', { env, fetchImpl: async () => ({ ok: false, status }) }), (err) => err.estado === (status < 500 ? 'falhou' : 'incerto'));
  }
  await assert.rejects(m.enviar(preparar('sms'), 'x', { env, fetchImpl: async () => { throw new Error('segredo-do-serviço'); } }), (err) => err.estado === 'incerto' && !err.message.includes('segredo-do-serviço'));
});

test('cada canal e cada novo sorteio têm identidade própria', () => {
  const chave = m.chaveEnvio(edicao, participante, 'sms');
  assert.equal(chave, m.chaveEnvio(edicao, participante, 'sms'));
  assert.notEqual(chave, m.chaveEnvio(edicao, participante, 'email'));
  assert.notEqual(chave, m.chaveEnvio({ ...edicao, status: 'sorteada', sorteado_em: '2026-12-24' }, participante, 'sms'));
});

const envMeta = { WA_PROVEDOR: 'meta', WA_API_TOKEN: 'token-fake', WA_PHONE_NUMBER_ID: '123456789', WA_GRAPH_VERSION: 'v26.0', WA_TEMPLATE_CONVITE: 'convite_familia', WA_TEMPLATE_RESULTADO: 'raspadinha_familia', WA_TEMPLATE_LANGUAGE: 'pt_BR' };

test('Meta direta envia modelos com nome e link, sem exigir Twilio', async () => {
  for (const e of [edicao, { ...edicao, status: 'sorteada', sorteado_em: '2026-12-24' }]) {
    const msg = preparar('whatsapp', e);
    m.validarAutomatico(msg, destinatario, envMeta);
    const result = await m.enviar(msg, 'chave-meta', { env: envMeta, fetchImpl: async (url, req) => {
      assert.equal(url, 'https://graph.facebook.com/v26.0/123456789/messages');
      assert.equal(req.headers.Authorization, 'Bearer token-fake');
      const body = JSON.parse(req.body);
      assert.equal(body.to, '5521999999999');
      assert.equal(body.messaging_product, 'whatsapp');
      assert.equal(body.template.name, e.status === 'sorteada' ? 'raspadinha_familia' : 'convite_familia');
      assert.equal(body.template.language.code, 'pt_BR');
      assert.deepEqual(body.template.components[0].parameters, [{ type: 'text', text: 'Criança' }, { type: 'text', text: msg.link }]);
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.fake' }] }) };
    } });
    assert.deepEqual(result, { id: 'wamid.fake', estado: 'aceito' });
  }
});

test('Meta valida modelo, token, ID, idioma e versão configurável', () => {
  for (const key of ['WA_API_TOKEN', 'WA_PHONE_NUMBER_ID', 'WA_TEMPLATE_CONVITE', 'WA_GRAPH_VERSION']) {
    assert.throws(() => m.validarAutomatico(preparar('whatsapp'), destinatario, { ...envMeta, [key]: '' }));
  }
  assert.throws(() => m.validarAutomatico(preparar('whatsapp'), destinatario, { ...envMeta, WA_PHONE_NUMBER_ID: '../outro' }));
  assert.throws(() => m.validarAutomatico(preparar('whatsapp'), destinatario, { ...envMeta, WA_TEMPLATE_LANGUAGE: 'português' }));
  assert.throws(() => m.validarAutomatico(preparar('whatsapp'), destinatario, { ...envMeta, WA_PROVEDOR: 'outro' }));
});

test('Meta exige identificador e trata resultado desconhecido como incerto', async () => {
  await assert.rejects(m.enviar(preparar('whatsapp'), 'x', { env: envMeta, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), (err) => err.estado === 'incerto');
});
