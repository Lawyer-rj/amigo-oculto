// Envio de foto: reduz no próprio celular antes de enviar (máx. 900 px, JPEG).
(function () {
  const input = document.getElementById('foto-input');
  if (!input) return;
  const status = document.getElementById('foto-status');

  function reduzir(arquivo) {
    return new Promise((ok, falha) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const esc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * esc);
        c.height = Math.round(img.height * esc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível ler a imagem.'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => falha(new Error('Formato de imagem não reconhecido.'));
      img.src = url;
    });
  }

  input.addEventListener('change', async () => {
    const arquivo = input.files && input.files[0];
    if (!arquivo) return;
    status.textContent = 'Enviando foto...';
    try {
      const pinFoto = document.getElementById('pin-foto');
      if (pinFoto && !/^\d{4,6}$/.test(pinFoto.value)) throw new Error('Informe seu PIN antes de enviar a foto.');
      const cabecalhos = {};
      if (pinFoto) cabecalhos['X-Participant-PIN'] = pinFoto.value;
      const csrf = document.querySelector('#foto-acesso input[name=csrf]');
      if (csrf) cabecalhos['X-CSRF-Token'] = csrf.value;
      const blob = await reduzir(arquivo);
      const fd = new FormData();
      fd.append('foto', blob, 'foto.jpg');
      const destino = input.dataset.admin ? `/admin/pessoas/${input.dataset.admin}/foto` : `/c/${input.dataset.token}/foto`;
      const r = await fetch(destino, { method: 'POST', headers: cabecalhos, body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.erro || 'Falha no envio.');
      const atual = document.querySelector('.foto-linha .avatar');
      const novo = document.createElement('img');
      novo.className = 'avatar';
      novo.src = j.foto;
      novo.alt = 'Sua foto';
      atual.replaceWith(novo);
      status.textContent = 'Foto salva!';
    } catch (e) {
      status.textContent = e.message;
    }
  });
})();
