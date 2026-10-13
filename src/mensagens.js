'use strict';
const crypto = require('crypto');
const meta = require('./whatsapp-meta');

const CANAIS = ['whatsapp', 'sms', 'email'];
const ROTULOS = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' };

function provedorWhatsApp(env) {
  const provedor = env.WA_PROVEDOR || 'twilio';
  if (!['twilio', 'meta'].includes(provedor)) throw new Error('WA_PROVEDOR deve ser meta ou twilio.');
  return provedor;
}

function telefone(v) {
  let n = String(v || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.length === 10 || n.length === 11) n = '55' + n;
  if (!/^[1-9]\d{7,14}$/.test(n)) throw new Error('Confira o telefone com DDD e código do país.');
  return '+' + n;
}

function preparar({ edicao, participante, destinatario, canal, baseUrl }) {
  if (!CANAIS.includes(canal)) throw new Error('Escolha WhatsApp, SMS ou e-mail.');
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('BASE_URL deve ser o endereço do aplicativo, sem caminho ou parâmetros.');
  }
  const link = `${base.origin}/c/${participante.token}`;
  const tipo = edicao.status === 'sorteada' ? 'resultado' : 'convite';
  const nome = String(participante.nome).replace(/[\r\n]/g, ' ');
  const edicaoNome = String(edicao.nome).replace(/[\r\n]/g, ' ');
  const saudacao = `Olá, ${destinatario.nome}!`;
  const acao = tipo === 'resultado'
    ? `O sorteio de ${edicaoNome} foi realizado. Abra a raspadinha de ${nome} usando o PIN criado na confirmação.`
    : `Este é o convite de ${nome} para ${edicaoNome}. Confirme a participação, crie seu PIN, envie a foto e até três sugestões de presente com links de compra.`;
  const texto = `${saudacao}\n\n${acao}\n${link}\n\nEste link é pessoal. Não o compartilhe.`;
  const curto = `${tipo === 'resultado' ? 'Sorteio realizado' : 'Convite'}: ${edicaoNome}. ${nome}: ${link}${tipo === 'resultado' ? ' Abra com seu PIN.' : ' Confirme e informe seus presentes.'}`;
  const destino = canal === 'email' ? String(destinatario.email || '').trim() : telefone(destinatario.telefone);
  if (canal === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(destino)) throw new Error('Cadastre um e-mail válido para o destinatário.');
  return { canal, destino, tipo, nome, edicaoNome, link, texto, curto, assunto: `${tipo === 'resultado' ? 'Sua raspadinha' : 'Seu convite'} — ${edicaoNome}` };
}

function linkManual(m) {
  if (m.canal === 'whatsapp') return `https://wa.me/${m.destino.slice(1)}?text=${encodeURIComponent(m.texto)}`;
  if (m.canal === 'email') return `mailto:${encodeURIComponent(m.destino)}?subject=${encodeURIComponent(m.assunto)}&body=${encodeURIComponent(m.texto)}`;
  return `sms:${m.destino}?body=${encodeURIComponent(m.curto)}`;
}

function validarAutomatico(m, destinatario, env = process.env) {
  if (!destinatario.autoriza_mensagens) throw new Error('Registre a autorização do destinatário no cadastro antes do envio pelo serviço.');
  const host = new URL(m.link).hostname;
  if (!m.link.startsWith('https://') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    throw new Error('Configure BASE_URL com o endereço público HTTPS antes do envio pelo serviço.');
  }
  if (m.canal === 'email') {
    if (!env.RESEND_API_KEY || !env.EMAIL_REMETENTE) throw new Error('Configure RESEND_API_KEY e EMAIL_REMETENTE.');
  } else if (m.canal === 'whatsapp' && provedorWhatsApp(env) === 'meta') {
    meta.montarRequisicao(m, env);
  } else {
    if (!/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') || !env.TWILIO_AUTH_TOKEN) throw new Error('Configure a conta e o token da Twilio.');
    if (m.canal === 'sms') {
      if (!env.TWILIO_SMS_FROM) throw new Error('Configure TWILIO_SMS_FROM.');
      telefone(env.TWILIO_SMS_FROM);
    } else {
      if (!env.TWILIO_WHATSAPP_FROM) throw new Error('Configure TWILIO_WHATSAPP_FROM.');
      telefone(env.TWILIO_WHATSAPP_FROM.replace(/^whatsapp:/, ''));
      const sid = m.tipo === 'resultado' ? env.TWILIO_WHATSAPP_RESULTADO_SID : env.TWILIO_WHATSAPP_CONVITE_SID;
      if (!/^HX[0-9a-f]{32}$/i.test(sid || '')) throw new Error('Configure o modelo aprovado de WhatsApp para este tipo de mensagem.');
    }
  }
}

async function enviar(m, chave, { env = process.env, fetchImpl = fetch } = {}) {
  let url, headers, body;
  const usaMeta = m.canal === 'whatsapp' && provedorWhatsApp(env) === 'meta';
  if (m.canal === 'email') {
    url = 'https://api.resend.com/emails';
    headers = { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': chave };
    body = JSON.stringify({ from: env.EMAIL_REMETENTE, to: [m.destino], subject: m.assunto, text: m.texto });
  } else if (usaMeta) {
    ({ url, headers, body } = meta.montarRequisicao(m, env));
  } else {
    url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    headers = { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' };
    const campos = { To: m.canal === 'whatsapp' ? `whatsapp:${m.destino}` : m.destino };
    if (m.canal === 'sms') {
      campos.From = telefone(env.TWILIO_SMS_FROM);
      campos.Body = m.curto;
    } else {
      campos.From = `whatsapp:${telefone(env.TWILIO_WHATSAPP_FROM.replace(/^whatsapp:/, ''))}`;
      campos.ContentSid = m.tipo === 'resultado' ? env.TWILIO_WHATSAPP_RESULTADO_SID : env.TWILIO_WHATSAPP_CONVITE_SID;
      campos.ContentVariables = JSON.stringify({ '1': m.nome, '2': m.edicaoNome, '3': m.link });
    }
    body = new URLSearchParams(campos).toString();
  }
  let resposta;
  try {
    resposta = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    if (!resposta.ok) {
      const erro = new Error(`O serviço respondeu HTTP ${resposta.status}. Confira a configuração e o painel do serviço.`);
      erro.estado = resposta.status >= 400 && resposta.status < 500 ? 'falhou' : 'incerto';
      throw erro;
    }
    const dados = await resposta.json();
    const id = m.canal === 'email' ? dados.id : usaMeta ? dados.messages?.[0]?.id : dados.sid;
    if (!id) throw new Error('O serviço não retornou o identificador do envio.');
    return { id, estado: 'aceito' };
  } catch (err) {
    if (err.estado) throw err;
    const erro = new Error('Não foi possível confirmar o envio. Confira o painel do serviço antes de tentar por outro canal.');
    erro.estado = 'incerto';
    throw erro;
  }
}

function chaveEnvio(edicao, participante, canal) {
  return crypto.createHash('sha256').update(JSON.stringify([edicao.id, participante.id, canal, edicao.status === 'sorteada' ? edicao.sorteado_em : 'convite'])).digest('hex');
}

module.exports = { CANAIS, ROTULOS, telefone, preparar, linkManual, validarAutomatico, enviar, chaveEnvio };
