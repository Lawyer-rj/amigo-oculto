'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const publicDir = path.join(__dirname, '..', 'public');
const hashVisual = crypto.createHash('sha256');
for (const arquivo of fs.readdirSync(publicDir).sort()) {
  const local = path.join(publicDir, arquivo);
  if (fs.statSync(local).isFile()) hashVisual.update(arquivo).update(fs.readFileSync(local));
}
const VERSAO_VISUAL = hashVisual.digest('hex').slice(0, 12);

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

function pagina({ titulo, selo = 'Amigo Oculto', cabecalho, corpo, largo = false, scripts = [], nav = '', experiencia = '' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#52344f">
<title>${h(titulo)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css?v=${VERSAO_VISUAL}">
</head>
<body class="${nav ? 'pagina-admin' : 'pagina-participante'} ${experiencia ? 'experiencia-' + h(experiencia) : ''}">
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<header class="topo">
  <div class="marca"><span class="marca-simbolo" aria-hidden="true">✳</span><span>amigo<span class="marca-oculto">oculto.</span></span><span class="marca-assinatura">feito em família</span></div>
  <div class="selo">${h(selo)}</div>
  <h1>${cabecalho ?? h(titulo)}</h1>
  <div class="fita"></div>
  ${nav}
</header>
<main id="conteudo" class="miolo${largo ? ' largo' : ''}">
${corpo}
</main>
<footer class="rodape"><span class="rodape-marca">Um presente. Muitas histórias.</span> Feito em família · Seus dados ficam nesta brincadeira.</footer>
${[...new Set(['/interface.js', ...scripts])].map((s) => `<script src="${h(s)}?v=${VERSAO_VISUAL}" defer></script>`).join('\n')}
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
