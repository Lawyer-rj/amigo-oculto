'use strict';
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || '';
if (SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET ausente ou curto (mínimo 32 caracteres).');
  }
  console.warn('[aviso] APP_SECRET não definido; usando valor de desenvolvimento.');
}
const BASE = SECRET.length >= 32 ? SECRET : 'desenvolvimento-nao-use-em-producao-0000';

const chavePares = crypto.createHash('sha256').update(BASE + ':pares').digest();
const chaveSessao = crypto.createHash('sha256').update(BASE + ':sessao').digest();

function token() {
  return crypto.randomBytes(16).toString('base64url');
}

/* ---- Cifra dos pares: o id do destinatário, autenticado pelo id de quem tirou ---- */
function cifrar(valor, contexto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chavePares, iv);
  c.setAAD(Buffer.from(String(contexto)));
  const ct = Buffer.concat([c.update(String(valor), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decifrar(b64, contexto) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', chavePares, buf.subarray(0, 12));
  d.setAAD(Buffer.from(String(contexto)));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

/* ---- PIN do participante (o organizador não o conhece) ---- */
function hashPin(pin) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pin), sal, 32);
  return sal.toString('hex') + ':' + h.toString('hex');
}

function confereHash(segredo, armazenado) {
  if (!armazenado) return false;
  const [sal, h] = armazenado.split(':');
  const calc = crypto.scryptSync(String(segredo), Buffer.from(sal, 'hex'), 32);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

/* ---- Sessão do organizador: cookie assinado com validade ---- */
function assinarSessao(horas = 12) {
  const ate = Date.now() + horas * 3600e3;
  const sig = crypto.createHmac('sha256', chaveSessao).update(String(ate)).digest('base64url');
  return `${ate}.${sig}`;
}

function sessaoValida(valor) {
  if (!valor || !valor.includes('.')) return false;
  const [ate, sig] = valor.split('.');
  const esperado = crypto.createHmac('sha256', chaveSessao).update(ate).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(ate) > Date.now();
}

function senhaAdminConfere(senha) {
  const esperada = process.env.ADMIN_SENHA || (process.env.NODE_ENV === 'production' ? '' : 'admin');
  if (!esperada) return false;
  const a = crypto.createHash('sha256').update(String(senha)).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { token, cifrar, decifrar, hashPin, confereHash, assinarSessao, sessaoValida, senhaAdminConfere };
