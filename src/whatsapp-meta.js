'use strict';
// Adaptado de Rodaviva29/secret-santa, lib/whatsapp.ts (branch v2).
// Copyright (c) 2024 João Chung — MIT. Veja THIRD-PARTY-NOTICES.md.
// Mantém apenas o modo de link: o par sorteado nunca entra na mensagem.

function montarRequisicao(m, env = process.env) {
  const token = env.WA_API_TOKEN;
  const phoneId = env.WA_PHONE_NUMBER_ID;
  const template = m.tipo === 'resultado' ? env.WA_TEMPLATE_RESULTADO : env.WA_TEMPLATE_CONVITE;
  const language = env.WA_TEMPLATE_LANGUAGE || 'pt_BR';
  const version = env.WA_GRAPH_VERSION;
  if (!token || !/^\d+$/.test(phoneId || '')) throw new Error('Configure WA_API_TOKEN e WA_PHONE_NUMBER_ID para a Meta.');
  if (!/^[a-z0-9_]+$/.test(template || '')) throw new Error('Configure o nome do modelo aprovado da Meta para este tipo de mensagem.');
  if (!/^v\d+\.\d+$/.test(version || '')) throw new Error('Configure WA_GRAPH_VERSION com uma versão suportada indicada no painel da Meta.');
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)) throw new Error('Confira WA_TEMPLATE_LANGUAGE, por exemplo pt_BR.');
  return {
    url: `https://graph.facebook.com/${version}/${phoneId}/messages`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: m.destino.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: m.nome },
          { type: 'text', text: m.link },
        ] }],
      },
    }),
  };
}

module.exports = { montarRequisicao };
