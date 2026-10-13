'use strict';
const crypto = require('crypto');
const seg = require('./seguranca');
const { db } = require('./db');

function hashCodigo(codigo) {
  return crypto.createHash('sha256').update(String(codigo || '')).digest('hex');
}
function novoCodigo() {
  const codigo = crypto.randomBytes(18).toString('base64url');
  return { codigo, hash: hashCodigo(codigo) };
}
function validar(p, valor, tipo = 'codigo') {
  if (p.pin_bloqueio_ate && new Date(p.pin_bloqueio_ate).getTime() > Date.now()) return 'Muitas tentativas. Aguarde 15 minutos.';
  let confere = false;
  if (tipo === 'pin') {
    confere = /^\d{4,6}$/.test(valor || '') && seg.confereHash(valor, p.pin_hash);
  } else if (/^[A-Za-z0-9_-]{24}$/.test(valor || '') && p.pin_recuperacao_hash) {
    const recebido = Buffer.from(hashCodigo(valor));
    const esperado = Buffer.from(p.pin_recuperacao_hash);
    confere = recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  }
  if (!confere) {
    const tentativas = p.pin_tentativas + 1;
    const ate = tentativas >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
    db.prepare('UPDATE participacoes SET pin_tentativas = ?, pin_bloqueio_ate = ? WHERE id = ?').run(ate ? 0 : tentativas, ate, p.id);
    return ate ? 'Acesso bloqueado por 15 minutos.' : 'PIN ou código de recuperação incorreto.';
  }
  db.prepare('UPDATE participacoes SET pin_tentativas = 0, pin_bloqueio_ate = NULL WHERE id = ?').run(p.id);
  return null;
}
module.exports = { novoCodigo, validar };
