'use strict';
const path = require('path');
const express = require('express');
const { PASTA: PASTA_FOTOS } = require('./fotos');
const servico = require('./servico');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Os links pessoais trazem o token na URL: nunca enviá-los como "referer" a lojas externas.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  if (req.path.startsWith('/c/') || req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/fotos', express.static(PASTA_FOTOS, { maxAge: '7d', index: false, dotfiles: 'deny' }));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/saude', (req, res) => res.json({ ok: true }));

app.use(require('./interacoes'));
app.use(require('./convidado'));
app.use(require('./admin'));

app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ ok: false, erro: 'Imagem muito grande (máx. 8 MB).' });
  res.status(500).send('Erro inesperado. Tente novamente.');
});

const PORTA = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORTA, () => console.log(`Amigo Oculto no ar na porta ${PORTA}`));
  servico.iniciarAgendador();
}

module.exports = app;
