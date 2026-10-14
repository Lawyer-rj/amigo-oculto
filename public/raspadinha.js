// Raspadinha: o resultado só chega do servidor depois do PIN correto.
(function () {
  const sec = document.getElementById('raspadinha');
  if (!sec) return;
  const token = sec.dataset.token;
  const form = document.getElementById('form-pin');
  const erro = document.getElementById('pin-erro');
  const area = document.getElementById('raspa-area');
  const premio = document.getElementById('raspa-premio');
  const canvas = document.getElementById('raspa-canvas');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    const pin = form.elements.pin?.value;
    const csrf = sec.dataset.csrf;
    const r = await fetch(`/c/${token}/revelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, csrf }),
    });
    const j = await r.json();
    if (!r.ok || j.erro) {
      erro.textContent = j.erro || 'Não foi possível abrir.';
      erro.hidden = false;
      return;
    }
    form.hidden = true;
    montar(j);
  });

  function montar(d) {
    const ini = d.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    premio.innerHTML = `
      ${d.foto ? `<img class="avatar" src="${esc(d.foto)}" alt="">` : `<div class="avatar vazio">${esc(ini)}</div>`}
      <div class="rot">Seu amigo oculto é</div>
      <h3>${esc(d.nome)}</h3>
      ${d.sugestoes.length ? `<div class="rot">Sugestões de presente</div><ul>${d.sugestoes.map((s) => {
        const extras = [
          s.cor && `<span><b>Cor:</b> ${esc(s.cor)}</span>`,
          s.tamanho && `<span><b>Tamanho:</b> ${esc(s.tamanho)}</span>`,
        ].filter(Boolean).join('');
        return `
        <li><div class="sg-titulo">${esc(s.texto)}</div>
          ${extras ? `<div class="sg-extras">${extras}</div>` : ''}
          ${s.detalhes ? `<div class="sg-linha">${esc(s.detalhes)}</div>` : ''}
          ${s.onde ? `<div class="sg-linha"><b>Onde encontrar:</b> ${esc(s.onde)}</div>` : ''}
          ${s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">Ver o produto ↗</a>` : ''}
        </li>`;
      }).join('')}</ul>`
        : '<p class="muted">Sem sugestões cadastradas. Use a criatividade!</p>'}`;
    area.hidden = false;
    requestAnimationFrame(cobrir);
  }

  function cobrir() {
    const wrap = canvas.parentElement;
    wrap.classList.add('raspando');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const hgt = wrap.clientHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Camada dourada com estrelas e instrução
    const g = ctx.createLinearGradient(0, 0, w, hgt);
    g.addColorStop(0, '#d9b84a'); g.addColorStop(.5, '#f3e3a6'); g.addColorStop(1, '#b8921c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 70; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * hgt, Math.random() * 2.2 + .4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#5a430a';
    ctx.textAlign = 'center';
    ctx.font = '700 26px Fraunces, Georgia, serif';
    ctx.fillText('🎁 Raspe aqui', w / 2, hgt / 2 - 6);
    ctx.font = '700 15px "Nunito Sans", sans-serif';
    ctx.fillText('passe o dedo sobre o dourado', w / 2, hgt / 2 + 22);

    ctx.globalCompositeOperation = 'destination-out';
    let raspando = false;
    let ultimo = null;
    let terminou = false;

    const ponto = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const raspar = (p) => {
      ctx.lineWidth = 46;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (ultimo) ctx.moveTo(ultimo.x, ultimo.y); else ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + .1, p.y + .1);
      ctx.stroke();
      ultimo = p;
    };
    const conferir = () => {
      if (terminou) return;
      const dados = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let limpos = 0, total = 0;
      for (let i = 3; i < dados.length; i += 4 * 40) { total++; if (dados[i] === 0) limpos++; }
      if (limpos / total > 0.55) {
        terminou = true;
        canvas.style.transition = 'opacity .6s ease';
        canvas.style.opacity = '0';
        setTimeout(() => { canvas.remove(); wrap.classList.remove('raspando'); }, 650);
        festa();
      }
    };

    canvas.addEventListener('pointerdown', (ev) => { raspando = true; ultimo = null; canvas.setPointerCapture(ev.pointerId); raspar(ponto(ev)); });
    canvas.addEventListener('pointermove', (ev) => { if (raspando) raspar(ponto(ev)); });
    const parar = () => { if (raspando) { raspando = false; ultimo = null; conferir(); } };
    canvas.addEventListener('pointerup', parar);
    canvas.addEventListener('pointercancel', parar);
  }

  function festa() {
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const cores = ['#b3261e', '#c9a227', '#2e7d4f', '#fbf6ec', '#f3e3a6'];
    const peças = Array.from({ length: 140 }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5,
      vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4,
      r: 4 + Math.random() * 5, cor: cores[(Math.random() * cores.length) | 0], a: Math.random() * 6,
    }));
    let t = 0;
    (function quadro() {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of peças) {
        p.x += p.vx; p.y += p.vy; p.a += .1;
        ctx.fillStyle = p.cor;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore();
      }
      if (++t < 200) requestAnimationFrame(quadro); else c.remove();
    })();
  }
})();
