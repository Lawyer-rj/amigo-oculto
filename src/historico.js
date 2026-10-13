'use strict';
const { db } = require('./db');
const { h } = require('./layout');

function registrar(grupo, ano, de, para) {
  if (!Number.isInteger(ano) || ano < 1900 || ano >= new Date().getFullYear()) throw new Error('Informe um ano anterior ao atual.');
  if (!grupo || !de || !para || de === para) throw new Error('Escolha o grupo e duas pessoas diferentes.');
  return db.transaction(() => {
    db.prepare('INSERT INTO historico_anos (grupo_id, ano) VALUES (?, ?) ON CONFLICT(grupo_id, ano) DO NOTHING').run(grupo, ano);
    const historico = db.prepare('SELECT id FROM historico_anos WHERE grupo_id = ? AND ano = ?').get(grupo, ano);
    const outro = db.prepare('SELECT de_id FROM historico_pares WHERE historico_id = ? AND para_id = ? AND de_id <> ?').get(historico.id, para, de);
    if (outro) throw new Error('Essa pessoa já aparece como destinatária de outro presente nesse ano. Confira os pares.');
    db.prepare('INSERT INTO historico_pares (historico_id, de_id, para_id) VALUES (?, ?, ?) ON CONFLICT(historico_id, de_id) DO UPDATE SET para_id = excluded.para_id').run(historico.id, de, para);
    return historico.id;
  })();
}
function anos(grupo, limite = Infinity) {
  return db.prepare('SELECT a.*, g.nome AS grupo_nome FROM historico_anos a JOIN grupos g ON g.id = a.grupo_id WHERE (? IS NULL OR grupo_id = ?) AND ano < ? ORDER BY ano DESC').all(grupo || null, grupo || null, Number.isFinite(limite) ? limite : 9999);
}
function pares(id) {
  return db.prepare('SELECT p.*, d.nome AS de_nome, r.nome AS para_nome FROM historico_pares p JOIN pessoas d ON d.id = p.de_id JOIN pessoas r ON r.id = p.para_id WHERE historico_id = ? ORDER BY alfa(d.nome)').all(id);
}
function mostrar(grupo, limite) {
  const lista = anos(grupo, limite);
  return lista.length ? lista.map((a) => `<section class="cartao"><span class="etiqueta">${h(a.grupo_nome)}</span><h2>A roda de ${a.ano}</h2><p class="muted">${pares(a.id).length} par(es) registrado(s). Você pode completar o ano aos poucos.</p><div class="rolagem"><table><tr><th>Quem presenteou</th><th>Quem recebeu</th></tr>${pares(a.id).map((p) => `<tr><td>${h(p.de_nome)}</td><td>${h(p.para_nome)}</td></tr>`).join('')}</table></div></section>`).join('') : '<section class="cartao"><h2>As histórias da nossa roda</h2><p>Os anos anteriores ainda não foram cadastrados. Quando o organizador registrar os pares, eles aparecerão aqui.</p></section>';
}
module.exports = { registrar, anos, pares, mostrar };
