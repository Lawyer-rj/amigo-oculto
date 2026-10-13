'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'fotos'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'amigo-oculto.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS pessoas (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  foto TEXT,
  responsavel_id INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grupos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grupo_membros (
  grupo_id INTEGER NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  nucleo TEXT,
  PRIMARY KEY (grupo_id, pessoa_id)
);

CREATE TABLE IF NOT EXISTS edicoes (
  id INTEGER PRIMARY KEY,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  nome TEXT NOT NULL,
  ano INTEGER NOT NULL,
  prazo_confirmacao TEXT,
  prazo_sugestoes TEXT,
  sorteio_em TEXT,
  entrega_em TEXT,
  entrega_local TEXT,
  valor_min REAL,
  valor_max REAL,
  mensagem TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',          -- aberta | sorteada
  sorteado_em TEXT,
  repeticoes INTEGER,
  quem_comeca_id INTEGER REFERENCES participacoes(id),
  ultimo_erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participacoes (
  id INTEGER PRIMARY KEY,
  edicao_id INTEGER NOT NULL REFERENCES edicoes(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente',        -- pendente | confirmado | recusado
  pin_hash TEXT,
  pin_tentativas INTEGER NOT NULL DEFAULT 0,
  pin_bloqueio_ate TEXT,
  pin_redefinido_em TEXT,
  respondido_em TEXT,
  convite_enviado_em TEXT,
  revelado_em TEXT,
  UNIQUE (edicao_id, pessoa_id)
);

CREATE TABLE IF NOT EXISTS sugestoes (
  id INTEGER PRIMARY KEY,
  participacao_id INTEGER NOT NULL REFERENCES participacoes(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  texto TEXT NOT NULL,
  link TEXT
);

CREATE TABLE IF NOT EXISTS indicacoes (
  id INTEGER PRIMARY KEY,
  edicao_id INTEGER NOT NULL REFERENCES edicoes(id) ON DELETE CASCADE,
  indicado_por INTEGER REFERENCES participacoes(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  telefone TEXT,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',        -- pendente | aceita | descartada
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pares do sorteio. O destinatário fica cifrado (AES-256-GCM): nem o painel
-- nem uma consulta direta ao banco revelam quem tirou quem.
CREATE TABLE IF NOT EXISTS pares (
  participacao_id INTEGER PRIMARY KEY REFERENCES participacoes(id) ON DELETE CASCADE,
  edicao_id INTEGER NOT NULL REFERENCES edicoes(id) ON DELETE CASCADE,
  destino_cifrado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registro (
  id INTEGER PRIMARY KEY,
  edicao_id INTEGER,
  evento TEXT NOT NULL,
  em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/* Ordenação alfabética em português: ignora acentos e maiúsculas (Álvaro antes de Bruno) */
db.function('alfa', { deterministic: true }, (v) =>
  v == null ? null : String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());

/* Migrações simples: acrescenta colunas novas em bancos já existentes */
function garantirColuna(tabela, coluna, tipo) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
}
garantirColuna('sugestoes', 'onde', 'TEXT');      // loja ou lugar onde encontrar
garantirColuna('sugestoes', 'cor', 'TEXT');
garantirColuna('sugestoes', 'tamanho', 'TEXT');   // tamanho, numeração ou medida
garantirColuna('sugestoes', 'detalhes', 'TEXT');  // marca, modelo, sabor, voltagem etc.

function log(edicaoId, evento) {
  db.prepare('INSERT INTO registro (edicao_id, evento) VALUES (?, ?)').run(edicaoId ?? null, evento);
}

module.exports = { db, log, DATA_DIR };
