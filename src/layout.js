'use strict';

function h(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function iniciais(nome) {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function avatar(foto, nome, cls = 'avatar') {
  return foto
    ? `<img class="${cls}" src="/fotos/${h(foto)}" alt="${h(nome)}">`
    : `<div class="${cls} vazio" aria-hidden="true">${h(iniciais(nome))}</div>`;
}

function pagina({ titulo, selo = 'Amigo Oculto', cabecalho, corpo, largo = false, scripts = [], nav = '' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0f2a1f">
<title>${h(titulo)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:wght@400;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css?v=5">
</head>
<body>
<header class="topo">
  <div class="selo">${h(selo)}</div>
  <h1>${cabecalho ?? h(titulo)}</h1>
  <div class="fita"></div>
  ${nav}
</header>
<main class="miolo${largo ? ' largo' : ''}">
${corpo}
</main>
<footer class="rodape">Feito em família. Seus dados são usados somente para este amigo oculto.</footer>
${scripts.map((s) => `<script src="${h(s)}?v=5" defer></script>`).join('\n')}
</body>
</html>`;
}

function aviso(req) {
  const ok = req.query.ok;
  const erro = req.query.erro;
  if (erro) return `<div class="aviso erro" role="alert">${h(erro)}</div>`;
  if (ok) return `<div class="aviso ok" role="status">${h(ok)}</div>`;
  return '';
}

module.exports = { h, pagina, avatar, iniciais, aviso };
