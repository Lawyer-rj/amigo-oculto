(function () {
  // Copiar link pessoal
  document.querySelectorAll('[data-copiar]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        const t = b.textContent; b.textContent = 'Copiado!';
        setTimeout(() => (b.textContent = t), 1500);
      } catch {
        prompt('Copie o link:', b.dataset.copiar);
      }
    });
  });
  // Marcar convite como enviado ao abrir o WhatsApp
  document.querySelectorAll('[data-marcar]').forEach((a) => {
    a.addEventListener('click', () => {
      fetch(a.dataset.marcar, { method: 'POST' }).catch(() => {});
    });
  });
  // Confirmação antes de ações sensíveis
  document.querySelectorAll('form[data-confirmar]').forEach((f) => {
    f.addEventListener('submit', (ev) => {
      if (!confirm(f.dataset.confirmar)) ev.preventDefault();
    });
  });
})();
