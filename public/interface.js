(function () {
  'use strict';
  document.querySelectorAll('.compras-detalhes').forEach((d) => { d.open = matchMedia('(min-width: 761px)').matches; });
  const abas = document.querySelector('[data-abas]');
  if (!abas) return;
  const botoes = [...abas.querySelectorAll('[data-etapa-alvo]')];
  const paineis = [...document.querySelectorAll('[data-etapa]')];
  if (!botoes.length || !paineis.length) return;
  abas.setAttribute('role', 'tablist');
  abas.setAttribute('aria-label', 'Seu cadastro');
  function selecionar(nome, focar = false) {
    botoes.forEach((b) => {
      const ativo = b.dataset.etapaAlvo === nome;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(ativo)); b.tabIndex = ativo ? 0 : -1;
      if (ativo && focar) b.focus();
    });
    paineis.forEach((p) => { p.hidden = p.dataset.etapa !== nome; p.setAttribute('role', 'tabpanel'); });
  }
  botoes.forEach((b, i) => {
    b.addEventListener('click', () => selecionar(b.dataset.etapaAlvo));
    b.addEventListener('keydown', (ev) => {
      let proximo;
      if (ev.key === 'ArrowRight') proximo = (i + 1) % botoes.length;
      if (ev.key === 'ArrowLeft') proximo = (i + botoes.length - 1) % botoes.length;
      if (ev.key === 'Home') proximo = 0;
      if (ev.key === 'End') proximo = botoes.length - 1;
      if (proximo !== undefined) { ev.preventDefault(); selecionar(botoes[proximo].dataset.etapaAlvo, true); }
    });
  });
  // Alertas depois de salvar permanecem visíveis acima das abas.
  const sucesso = new URLSearchParams(location.search).get('ok') || '';
  const inicial = /sugest/i.test(sucesso) ? 'presentes' : /dados|foto/i.test(sucesso) ? 'perfil' : abas.dataset.inicial;
  selecionar(botoes.some((b) => b.dataset.etapaAlvo === inicial) ? inicial : botoes[0].dataset.etapaAlvo);
})();
