'use strict';
const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const seg = require('./seguranca');
const acesso = require('./recuperacao');
const historico = require('./historico');
const s = require('./servico');
const { h, pagina, aviso } = require('./layout');
const r = express.Router();
const digest = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = (p) => `/c/${p.token}/interacoes`;
const versaoSorteio = (e) => e.sorteio_versao || e.sorteado_em;
const sessoes = require('./sessoes');
const sessao = sessoes.ler;

function carregar(req, res, next) {
  const p = s.q.participacaoPorToken.get(req.params.token);
  if (!p) return res.status(404).send('Link não encontrado.');
  req.part = p; req.edicao = s.q.edicao.get(p.edicao_id);
  next();
}
function autenticar(req, res, next) {
  req.sessao = sessao(req);
  if (!req.sessao || req.part.status !== 'confirmado') {
    if (req.path.endsWith('/estado')) return res.status(401).json({ erro: 'Entre novamente com seu PIN.' });
    return res.redirect(303, base(req.part));
  }
  if (req.method === 'POST' && req.body.csrf !== req.sessao.csrf) return res.status(403).send('Atualize a página e tente novamente.');
  next();
}
function nomes(edicao) {
  return db.prepare("SELECT p.id, pe.nome FROM participacoes p JOIN pessoas pe ON pe.id = p.pessoa_id WHERE p.edicao_id = ? AND p.status = 'confirmado' ORDER BY alfa(pe.nome)").all(edicao.id);
}
function participantesConversa(c) { return JSON.parse(seg.decifrar(c.vinculos_cifrados, `conversa:${c.id}`)); }
function conversaPermitida(p, e, id) {
  const c = db.prepare('SELECT * FROM conversas WHERE id = ? AND edicao_id = ?').get(id, e.id);
  if (!c || !participantesConversa(c).includes(p.id)) return null;
  if (c.tipo === 'anonima' && (e.status !== 'sorteada' || c.sorteio_versao !== versaoSorteio(e))) return null;
  return c;
}
function criarConversa(e, ids, tipo) {
  const lista = tipo === 'privada' ? [...ids].sort((a, b) => a - b) : ids;
  const existentes = db.prepare('SELECT * FROM conversas WHERE edicao_id = ? AND tipo = ?').all(e.id, tipo);
  const existe = existentes.find((c) => (tipo !== 'anonima' || c.sorteio_versao === versaoSorteio(e)) && JSON.stringify(participantesConversa(c)) === JSON.stringify(lista));
  if (existe) return existe;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO conversas (id, edicao_id, tipo, vinculos_cifrados, sorteio_versao) VALUES (?, ?, ?, ?, ?)')
    .run(id, e.id, tipo, seg.cifrar(JSON.stringify(lista), `conversa:${id}`), tipo === 'anonima' ? versaoSorteio(e) : null);
  return db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
}
function criarAnonimas(p, e) {
  if (e.status !== 'sorteada') return;
  const pares = db.prepare('SELECT participacao_id, destino_cifrado FROM pares WHERE edicao_id = ?').all(e.id);
  for (const par of pares) {
    const destino = Number(seg.decifrar(par.destino_cifrado, par.participacao_id));
    if (par.participacao_id === p.id || destino === p.id) criarConversa(e, [par.participacao_id, destino], 'anonima');
  }
}
function tituloConversa(c, p) {
  const ids = participantesConversa(c);
  if (c.tipo === 'anonima') return ids[0] === p.id ? 'Amigo que tirei — você fica anônimo' : 'Quem me tirou — identidade oculta';
  return s.q.participacao.get(ids.find((id) => id !== p.id))?.nome || 'Conversa privada';
}
function lerMensagens(p, e, c) {
  const linhas = c
    ? db.prepare('SELECT * FROM mensagens_interacao WHERE edicao_id = ? AND conversa_id = ? ORDER BY ordem DESC LIMIT 100').all(e.id, c.id)
    : db.prepare('SELECT * FROM mensagens_interacao WHERE edicao_id = ? AND conversa_id IS NULL ORDER BY ordem DESC LIMIT 100').all(e.id);
  return linhas.reverse().map((linha) => {
    const d = JSON.parse(seg.decifrar(linha.conteudo_cifrado, `mensagem:${linha.id}`));
    let autor = 'Você';
    if (d.autor !== p.id) {
      autor = c?.tipo === 'anonima' ? (participantesConversa(c)[0] === p.id ? 'Seu amigo sorteado' : 'Seu amigo oculto') : s.q.participacao.get(d.autor)?.nome || 'Participante';
    }
    return { id: linha.id, autor, texto: d.texto, em: linha.criado_em, minha: d.autor === p.id };
  });
}
function compras(e) {
  if (e.status !== 'sorteada') return [];
  return db.prepare(`SELECT p.id, pe.nome, p.presente_comprado_em FROM participacoes p JOIN pessoas pe ON pe.id = p.pessoa_id JOIN pares pa ON pa.participacao_id = p.id WHERE p.edicao_id = ? ORDER BY alfa(pe.nome)`).all(e.id)
    .map((p) => ({ id: p.id, nome: p.nome, comprado: !!p.presente_comprado_em }));
}
const redirect = (req, res, msg, erro = false, conversa = '') => res.redirect(303, `${base(req.part)}?${conversa ? `conversa=${encodeURIComponent(conversa)}&` : ''}${erro ? 'erro' : 'ok'}=${encodeURIComponent(msg)}`);
const hidden = (req) => `<input type="hidden" name="csrf" value="${h(req.sessao.csrf)}">`;

r.get('/c/:token/interacoes', carregar, (req, res) => {
  req.sessao = sessao(req);
  const p = req.part, e = req.edicao;
  const linkVoltar = `<a class="btn sec" href="/c/${h(p.token)}">Meu cadastro e raspadinha</a>`;
  if (!req.sessao || p.status !== 'confirmado') return res.send(pagina({ titulo: 'A brincadeira continua', selo: e.nome, experiencia: 'social', corpo: `${aviso(req)}<section class="cartao"><h2>Entre como ${h(p.nome)}</h2><p>Confirme sua participação e use seu PIN para conversar e acompanhar as compras. Para crianças, o responsável entra pelo link e PIN da criança.</p><form method="post" action="${base(p)}/entrar"><label for="pin-social">Seu PIN</label><input id="pin-social" type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="current-password"><button class="btn">Entrar</button></form>${linkVoltar}</section>` }));
  criarAnonimas(p, e);
  const c = req.query.conversa ? conversaPermitida(p, e, req.query.conversa) : null;
  if (req.query.conversa && !c) return res.status(404).send('Conversa não encontrada.');
  const conversas = db.prepare('SELECT * FROM conversas WHERE edicao_id = ? ORDER BY rowid').all(e.id).filter((x) => conversaPermitida(p, e, x.id));
  const membros = nomes(e).filter((x) => x.id !== p.id);
  const listaCompras = compras(e);
  const comprou = listaCompras.find((x) => x.id === p.id)?.comprado;
  const msgs = lerMensagens(p, e, c);
  const corpo = `${aviso(req)}
  <section class="cartao social-boas-vindas"><span class="etiqueta">Nossa roda, sempre perto</span><h2>Olá, ${h(p.nome)}!</h2><p>Converse com a família e acompanhe a brincadeira. Mensagens privadas só aparecem para os participantes da conversa.</p><div class="acoes">${linkVoltar}<a class="btn sec" href="${base(p)}/historico">Histórico da família</a><form method="post" action="${base(p)}/sair">${hidden(req)}<button class="btn sec">Sair deste perfil</button></form></div></section>
  <section class="cartao social-compras"><span class="etiqueta">A contagem para a surpresa</span><h2>Como estão as compras?</h2>${listaCompras.length ? `<p id="compras-resumo">${listaCompras.filter((x) => x.comprado).length} de ${listaCompras.length} já compraram.</p><details class="compras-detalhes"><summary>Ver quem já comprou</summary><ul id="compras-lista">${listaCompras.map((x) => `<li>${h(x.nome)}: ${x.comprado ? '✅ Já comprou' : '⏳ Ainda não marcou a compra'}</li>`).join('')}</ul></details>${listaCompras.some((x) => x.id === p.id) ? `<form method="post" action="${base(p)}/compra">${hidden(req)}<input type="hidden" name="comprado" value="${comprou ? '0' : '1'}"><button class="btn">${comprou ? 'Desmarcar minha compra' : 'Já comprei o presente!'}</button></form>` : ''}<p class="muted pequeno">O grupo vê somente quem comprou. O presente e o destinatário continuam em segredo.</p>` : '<p>O acompanhamento das compras estará disponível depois do sorteio.</p>'}</section>
  <section class="cartao social-chat"><span class="etiqueta">Tem assunto bom por aqui</span><h2>Conversas</h2><nav id="social-conversas" class="social-conversas"><a href="${base(p)}" ${!c ? 'aria-current="page"' : ''}>Mural da família</a>${conversas.map((x) => `<a href="${base(p)}?conversa=${x.id}" ${c?.id === x.id ? 'aria-current="page"' : ''}>${h(tituloConversa(x, p))}</a>`).join('')}</nav>
    <form method="post" action="${base(p)}/privada" class="acoes">${hidden(req)}<label for="pessoa-privada">Conversar com</label><select id="pessoa-privada" name="pessoa" required>${membros.map((x) => `<option value="${x.id}">${h(x.nome)}</option>`).join('')}</select><button class="btn sec" ${membros.length ? '' : 'disabled'}>Abrir conversa privada</button></form>
    <h3>${c ? h(tituloConversa(c, p)) : 'Mural da família'}</h3>${c?.tipo === 'anonima' ? '<p class="aviso info">Use esta conversa para perguntar sobre o presente. Evite assinar a mensagem ou dar pistas sobre sua identidade.</p>' : '<p class="muted pequeno">Aqui seu nome aparece nas mensagens.</p>'}
    <div id="social-mensagens" class="social-mensagens">${msgs.map((m) => `<article class="social-mensagem"><b>${h(m.autor)}</b><time>${h(s.formatar(m.em))}</time><p>${h(m.texto)}</p>${m.minha ? `<form method="post" action="${base(p)}/apagar">${hidden(req)}<input type="hidden" name="mensagem" value="${m.id}"><input type="hidden" name="conversa" value="${c?.id || ''}"><button class="btn sec mini">Apagar minha mensagem</button></form>` : ''}</article>`).join('') || '<p class="muted">Nenhuma mensagem ainda. Comece a conversa!</p>'}</div>
    <form method="post" action="${base(p)}/mensagem">${hidden(req)}<input type="hidden" name="conversa" value="${c?.id || ''}"><label for="texto-social">Sua mensagem</label><textarea id="texto-social" name="texto" maxlength="1000" required rows="3"></textarea><button class="btn">Enviar mensagem</button></form>
    <p id="social-status" class="muted pequeno" role="status">Atualização a cada 10 segundos enquanto esta página estiver aberta. São exibidas as últimas 100 mensagens.</p>
  </section><div id="social-config" data-estado="${base(p)}/estado${c ? `?conversa=${c.id}` : ''}" data-base="${base(p)}" data-conversa="${c?.id || ''}" data-csrf="${req.sessao.csrf}"></div>`;
  res.send(pagina({ titulo: 'A brincadeira continua', selo: e.nome, experiencia: 'social', largo: true, corpo, scripts: ['/interacoes.js'] }));
});

r.post('/c/:token/interacoes/entrar', carregar, (req, res) => {
  const p = req.part;
  if (p.status !== 'confirmado' || !p.pin_hash) return redirect(req, res, 'Confirme sua participação e crie seu PIN primeiro.', true);
  const erro = acesso.validar(p, req.body.pin, 'pin');
  if (erro) return redirect(req, res, erro, true);
  sessoes.criar(res, p);
  res.redirect(303, base(p));
});
r.use('/c/:token/interacoes', carregar, autenticar);
r.get('/c/:token/interacoes/historico', (req, res) => {
  res.send(pagina({ titulo: 'Histórico da família', selo: req.edicao.nome, corpo: `<a class="btn sec" href="${base(req.part)}">Voltar às conversas</a>${historico.mostrar(req.edicao.grupo_id, req.edicao.ano)}` }));
});
r.post('/c/:token/interacoes/sair' , (req, res) => {
  sessoes.sair(res, req.part, req.sessao);
  res.redirect(303, base(req.part));
});
r.get('/c/:token/interacoes/estado', (req, res) => {
  const c = req.query.conversa ? conversaPermitida(req.part, req.edicao, req.query.conversa) : null;
  if (req.query.conversa && !c) return res.status(404).json({ erro: 'Conversa indisponível. Volte ao mural.' });
  criarAnonimas(req.part, req.edicao);
  const conversas = db.prepare('SELECT * FROM conversas WHERE edicao_id = ? ORDER BY rowid').all(req.edicao.id)
    .filter((x) => conversaPermitida(req.part, req.edicao, x.id)).map((x) => ({ id: x.id, titulo: tituloConversa(x, req.part) }));
  res.json({ compras: compras(req.edicao), mensagens: lerMensagens(req.part, req.edicao, c), conversas });
});
r.post('/c/:token/interacoes/compra', (req, res) => {
  if (req.edicao.status !== 'sorteada' || !db.prepare('SELECT 1 FROM pares WHERE participacao_id = ?').get(req.part.id)) return redirect(req, res, 'Você precisa participar do sorteio para marcar a compra.', true);
  if (!['0', '1'].includes(req.body.comprado)) return res.status(400).send('Escolha marcar ou desmarcar a compra.');
  db.prepare('UPDATE participacoes SET presente_comprado_em = ? WHERE id = ?').run(req.body.comprado === '1' ? s.agoraISO() : null, req.part.id);
  redirect(req, res, req.body.comprado === '1' ? 'Compra marcada! O grupo só verá que você comprou.' : 'Compra desmarcada.');
});
r.post('/c/:token/interacoes/privada', (req, res) => {
  const outro = s.q.participacao.get(Number(req.body.pessoa));
  if (!outro || outro.edicao_id !== req.part.edicao_id || outro.id === req.part.id || outro.status !== 'confirmado') return redirect(req, res, 'Escolha outra pessoa confirmada nesta edição.', true);
  const c = criarConversa(req.edicao, [req.part.id, outro.id], 'privada');
  res.redirect(303, `${base(req.part)}?conversa=${c.id}`);
});
const ultimosEnvios = new Map();
r.post('/c/:token/interacoes/mensagem', (req, res) => {
  const c = req.body.conversa ? conversaPermitida(req.part, req.edicao, req.body.conversa) : null;
  if (req.body.conversa && !c) return res.status(404).send('Conversa não encontrada.');
  if (typeof req.body.texto !== 'string' || !req.body.texto.trim() || req.body.texto.length > 1000) return redirect(req, res, 'Escreva uma mensagem de até 1.000 caracteres.', true, c?.id);
  const agora = Date.now(), tempos = (ultimosEnvios.get(req.part.id) || []).filter((x) => agora - x < 30000);
  if (tempos.length >= 5) return res.status(429).send('Muitas mensagens seguidas. Aguarde alguns segundos.');
  tempos.push(agora); ultimosEnvios.set(req.part.id, tempos);
  const id = crypto.randomUUID();
  const conteudo = JSON.stringify({ autor: req.part.id, texto: req.body.texto.trim() });
  db.prepare('INSERT INTO mensagens_interacao (id, edicao_id, conversa_id, conteudo_cifrado, criado_em) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.edicao.id, c?.id || null, seg.cifrar(conteudo, `mensagem:${id}`), s.agoraISO());
  redirect(req, res, 'Mensagem enviada.', false, c?.id);
});
r.post('/c/:token/interacoes/apagar', (req, res) => {
  const m = db.prepare('SELECT * FROM mensagens_interacao WHERE id = ? AND edicao_id = ?').get(req.body.mensagem, req.edicao.id);
  if (!m || (m.conversa_id && !conversaPermitida(req.part, req.edicao, m.conversa_id))) return res.status(404).send('Mensagem não encontrada.');
  if (JSON.parse(seg.decifrar(m.conteudo_cifrado, `mensagem:${m.id}`)).autor !== req.part.id) return res.status(403).send('Você só pode apagar suas próprias mensagens.');
  db.prepare('DELETE FROM mensagens_interacao WHERE id = ?').run(m.id);
  redirect(req, res, 'Mensagem apagada.', false, m.conversa_id);
});
r.sessaoParticipante = sessao;
module.exports = r;
