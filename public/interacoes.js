(function () {
  'use strict';
  const config = document.getElementById('social-config');
  if (!config) return;
  const lista = document.getElementById('social-mensagens');
  const status = document.getElementById('social-status');
  let ultimaVersao = '';
  let ultimasConversas = '';
  let ocupado = false;
  const texto = (tag, conteudo) => { const el = document.createElement(tag); el.textContent = conteudo; return el; };
  async function atualizar() {
    if (document.hidden || ocupado) return;
    ocupado = true;
    try {
      const resposta = await fetch(config.dataset.estado, { cache: 'no-store' });
      const dados = await resposta.json();
      if (!resposta.ok) {
        status.textContent = dados.erro || 'Atualize a página para continuar.';
        if (resposta.status === 401 || resposta.status === 404) clearInterval(intervalo);
        return;
      }
      const versao = JSON.stringify(dados.mensagens);
      if (versao !== ultimaVersao) {
        const elementos = dados.mensagens.map((m) => {
          const artigo = document.createElement('article'); artigo.className = 'social-mensagem';
          artigo.append(texto('b', m.autor), texto('time', new Date(m.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })), texto('p', m.texto));
          if (m.minha) {
            const form = document.createElement('form'); form.method = 'post'; form.action = config.dataset.base + '/apagar';
            for (const [nome, valor] of Object.entries({ csrf: config.dataset.csrf, mensagem: m.id, conversa: config.dataset.conversa })) {
              const campo = document.createElement('input'); campo.type = 'hidden'; campo.name = nome; campo.value = valor; form.append(campo);
            }
            const botao = texto('button', 'Apagar minha mensagem'); botao.className = 'btn sec mini'; form.append(botao); artigo.append(form);
          }
          return artigo;
        });
        lista.replaceChildren(...(elementos.length ? elementos : [texto('p', 'Nenhuma mensagem ainda. Comece a conversa!')]));
        ultimaVersao = versao;
      }
      const compras = document.getElementById('compras-lista');
      if (compras) {
        compras.replaceChildren(...dados.compras.map((p) => texto('li', `${p.nome}: ${p.comprado ? '✅ Já comprou' : '⏳ Ainda não marcou a compra'}`)));
        document.getElementById('compras-resumo').textContent = `${dados.compras.filter((p) => p.comprado).length} de ${dados.compras.length} já compraram.`;
      }
      const conversasVersao = JSON.stringify(dados.conversas);
      if (conversasVersao !== ultimasConversas) {
        const itens = [{ id: '', titulo: 'Mural da família' }, ...dados.conversas].map((c) => {
          const a = texto('a', c.titulo); a.href = config.dataset.base + (c.id ? `?conversa=${c.id}` : '');
          if (c.id === config.dataset.conversa) a.setAttribute('aria-current', 'page');
          return a;
        });
        document.getElementById('social-conversas').replaceChildren(...itens);
        ultimasConversas = conversasVersao;
      }
      status.textContent = 'Conversas e compras atualizadas. Acompanhe por aqui; não há avisos externos.';
    } catch {
      status.textContent = 'Conexão interrompida. Suas mensagens escritas continuam aqui; tentaremos atualizar novamente.';
    } finally { ocupado = false; }
  }
  const intervalo = setInterval(atualizar, 10000);
  document.addEventListener('visibilitychange', atualizar);
  window.addEventListener('pagehide', () => clearInterval(intervalo), { once: true });
  atualizar();
})();
