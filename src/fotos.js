'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, DATA_DIR } = require('./db');

const PASTA = path.join(DATA_DIR, 'fotos');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

function tipoPorAssinatura(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Grava a foto de uma pessoa com nome aleatório e apaga a anterior. */
function salvarFoto(pessoaId, arquivo) {
  if (!arquivo) throw new Error('Nenhuma imagem recebida.');
  const ext = tipoPorAssinatura(arquivo.buffer);
  if (!ext) throw new Error('Formato não aceito. Envie uma foto JPG, PNG ou WEBP.');
  const nome = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PASTA, nome), arquivo.buffer);
  const antiga = db.prepare('SELECT foto FROM pessoas WHERE id = ?').get(pessoaId)?.foto;
  db.prepare('UPDATE pessoas SET foto = ? WHERE id = ?').run(nome, pessoaId);
  if (antiga && /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(antiga)) {
    fs.rm(path.join(PASTA, antiga), { force: true }, () => {});
  }
  return nome;
}

module.exports = { upload, salvarFoto, PASTA };
