'use strict';
const express = require('express');
const { db, log } = require('./db');
const seg = require('./seguranca');
const s = require('./servico');
const { upload, salvarFoto } = require('./fotos');
const { h, pagina, avatar, aviso } = require('./layout');

const r = express.Router();
const BASE_URL = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const limpar = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const COOKIE = 'ao_admin';

/* ------------------------------------------------------------------ */
/* Autenticação                                                         */
/* ------------------------------------------------------------------ */
function lerCookie(req, nome) {
  const c = req.headers.cookie || '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
}

const tentativas = new Map(); // ip -> { n, ate }
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 8 && t.ate > Date.now();
}

r.get('/admin/entrar', (req, res) => {
  res.send(pagina({
    titulo: 'Painel do organizador',
    corpo: `${aviso(req)}
    <form class="cartao" method="post" action="/admin/entrar">
      <label for="senha">Senha do organizador</label>
      <input type="password" id="senha" name="senha" required autofocus autocomplete="current-password">
      <div class="acoes"><button class="btn bloco">Entrar</button></div>
    </form>`,
  }));
});

r.post('/admin/entrar', (req, res) => {
  const ip = req.ip;
  if (bloqueado(ip)) return res.redirect(303, '/admin/entrar?erro=' + encodeURIComponent('Muitas tentativas. Aguarde 15 minutos.'));
  if (!seg.senhaAdminConfere(req.body.senha || '')) {
    const t = tentativas.get(ip) || { n: 0, ate: 0 };
    t.n += 1; t.ate = Date.now() + 15 * 60e3;
    tentativas.set(ip, t);
    return res.redirect(303, '/admin/entrar?erro=' + encodeURIComponent('Senha incorreta.'));
  }
  tentativas.delete(ip);
  const seguro = BASE_URL().startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${seg.assinarSessao()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${seguro}`);
  res.redirect(303, '/admin');
});

r.post('/admin/sair', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.redirect(303, '/admin/entrar');
});

r.use('/admin', (req, res, next) => {
  if (seg.sessaoValida(lerCookie(req, COOKIE))) return next();
  if (req.method === 'GET') return res.redirect(303, '/admin/entrar');
  res.status(401).send('Sessão expirada. Entre novamente.');
});

const volta = (res, url, msg, erro = false) =>
  res.redirect(303, `${url}${url.includes('?') ? '&' : '?'}${erro ? 'erro' : 'ok'}=${encodeURIComponent(msg)}`);

function nav(ativo) {
  const it = [['/admin', 'Edições'], ['/admin/pessoas', 'Pessoas'], ['/admin/grupos', 'Grupos']];
  return `<nav class="nav">${it.map(([u, t]) => `<a href="${u}" class="${ativo === u ? 'ativo' : ''}">${t}</a>`).join('')}
    <form method="post" action="/admin/sair" style="display:inline"><button class="btn sec mini" style="background:transparent;color:#fbf6ec;border-color:rgba(255,255,255,.2)">Sair</button></form></nav>`;
}

function tela(req, res, { titulo, corpo, ativo, scripts = [] }) {
  res.send(pagina({ titulo, selo: 'Painel do organizador', corpo: aviso(req) + corpo, largo: true, nav: nav(ativo), scripts: ['/admin.js', ...scripts] }));
}

/* ------------------------------------------------------------------ */
/* Edições                                                              */
/* ------------------------------------------------------------------ */
r.get('/admin', (req, res) => {
  const edicoes = db.prepare(`
    SELECT e.*, g.nome AS grupo_nome,
      (SELECT COUNT(*) FROM participacoes p WHERE p.edicao_id = e.id) AS total,
      (SELECT COUNT(*) FROM participacoes p WHERE p.edicao_id = e.id AND p.status = 'confirmado') AS conf
    FROM edicoes e JOIN grupos g ON g.id = e.grupo_id ORDER BY e.ano DESC, e.id DESC`).all();
  const grupos = db.prepare('SELECT * FROM grupos ORDER BY alfa(nome)').all();
  const ano = new Date().getFullYear();
  tela(req, res, {
    titulo: 'Edições', ativo: '/admin',
    corpo: `
    <section class="cartao">
      <h2>Edições</h2>
      ${edicoes.length ? `<div class="rolagem"><table>
        <tr><th>Edição</th><th>Grupo</th><th>Confirmados</th><th>Sorteio</th><th>Situação</th></tr>
        ${edicoes.map((e) => `<tr>
          <td><a href="/admin/edicoes/${e.id}"><b>${h(e.nome)}</b></a></td>
          <td>${h(e.grupo_nome)}</td><td>${e.conf} de ${e.total}</td>
          <td>${h(s.formatar(e.sorteio_em))}</td>
          <td><span class="pill ${e.status === 'sorteada' ? 'confirmado' : 'pendente'}">${e.status}</span></td></tr>`).join('')}
      </table></div>` : '<p class="muted">Nenhuma edição criada.</p>'}
    </section>
    <section class="cartao">
      <h2>Nova edição</h2>
      ${grupos.length ? `<form method="post" action="/admin/edicoes">
        <div class="grade-2">
          <div><label>Nome</label><input type="text" name="nome" required value="Amigo Oculto ${ano}"></div>
          <div><label>Ano</label><input type="number" name="ano" required value="${ano}"></div>
        </div>
        <label>Grupo</label>
        <select name="grupo_id">${grupos.map((g) => `<option value="${g.id}">${h(g.nome)}</option>`).join('')}</select>
        <label style="font-weight:400"><input type="checkbox" name="incluir" value="1" checked> Incluir todos os membros do grupo (cada um precisará confirmar de novo)</label>
        <div class="acoes"><button class="btn">Criar edição</button></div>
      </form>` : '<p>Crie primeiro um <a href="/admin/grupos">grupo</a>.</p>'}
    </section>`,
  });
});

r.post('/admin/edicoes', (req, res) => {
  const nome = limpar(req.body.nome, 80);
  const ano = Number(req.body.ano);
  const grupoId = Number(req.body.grupo_id);
  if (!nome || !ano || !grupoId) return volta(res, '/admin', 'Preencha nome, ano e grupo.', true);
  const id = db.prepare('INSERT INTO edicoes (grupo_id, nome, ano) VALUES (?, ?, ?)').run(grupoId, nome, ano).lastInsertRowid;
  const n = req.body.incluir ? s.incluirGrupoInteiro(id) : 0;
  log(id, `Edição criada com ${n} participante(s) do grupo.`);
  volta(res, `/admin/edicoes/${id}`, 'Edição criada. Agora defina datas e valores.');
});

function carregarEdicao(req, res, next) {
  const e = s.q.edicao.get(Number(req.params.id));
  if (!e) return res.status(404).send('Edição não encontrada.');
  req.edicao = e;
  next();
}

function textoConvite(e, p) {
  const url = `${BASE_URL()}/c/${p.token}`;
  const prazo = e.prazo_confirmacao ? `\nResponda até ${s.formatar(e.prazo_confirmacao)}.` : '';
  if (e.status === 'sorteada') {
    return p.responsavel_id
      ? `Olá, ${p.responsavel_nome.split(' ')[0]}! 🎁 O sorteio do *${e.nome}* foi realizado. Abra o link de ${p.nome} e raspe a tela para descobrir o amigo oculto:\n${url}`
      : `Olá, ${p.nome.split(' ')[0]}! 🎁 O sorteio do *${e.nome}* foi realizado. Abra seu link pessoal e raspe a tela para descobrir seu amigo oculto:\n${url}`;
  }
  return p.responsavel_id
    ? `Olá, ${p.responsavel_nome.split(' ')[0]}! 🎄 Este é o link pessoal de *${p.nome}* no *${e.nome}*. Por ele você confirma a participação, envia a foto e as sugestões de presente:\n${url}${prazo}`
    : `Olá, ${p.nome.split(' ')[0]}! 🎄 Você está convidado(a) para o *${e.nome}*. Neste link pessoal (não compartilhe) você confirma a participação, envia sua foto e até três sugestões de presente:\n${url}${prazo}`;
}

r.get('/admin/edicoes/:id', carregarEdicao, (req, res) => {
  const e = req.edicao;
  const parts = s.q.participantes.all(e.id);
  const c = s.contagens(e.id);
  const sorteada = e.status === 'sorteada';
  const semPin = parts.filter((p) => p.status === 'confirmado' && !p.pin_hash).length;
  const indic = db.prepare(`SELECT i.*, pe.nome AS por FROM indicacoes i
    LEFT JOIN participacoes p ON p.id = i.indicado_por LEFT JOIN pessoas pe ON pe.id = p.pessoa_id
    WHERE i.edicao_id = ? AND i.status = 'pendente' ORDER BY i.id`).all(e.id);
  const fora = db.prepare(`SELECT pe.id, pe.nome FROM pessoas pe
    WHERE pe.id NOT IN (SELECT pessoa_id FROM participacoes WHERE edicao_id = ?) ORDER BY alfa(pe.nome)`).all(e.id);
  const registro = db.prepare('SELECT * FROM registro WHERE edicao_id = ? ORDER BY id DESC LIMIT 80').all(e.id);
  const quem = e.quem_comeca_id ? s.q.participacao.get(e.quem_comeca_id) : null;
  const sim = req.query.sim ? JSON.parse(Buffer.from(req.query.sim, 'base64url').toString()) : null;

  let nucleo = null;
  const linhas = parts.map((p) => {
    let cab = '';
    if ((p.nucleo || '') !== nucleo) {
      nucleo = p.nucleo || '';
      cab = `<tr class="nucleo"><td colspan="8">${h(nucleo || 'Sem núcleo')}</td></tr>`;
    }
    const tel = p.responsavel_id ? p.responsavel_telefone : p.telefone;
    const wa = s.linkWhatsApp(tel, textoConvite(e, p));
    const link = `${BASE_URL()}/c/${p.token}`;
    return cab + `<tr>
      <td>${avatar(p.foto, p.nome, 'ini')}</td>
      <td><b>${h(p.nome)}</b>${p.responsavel_id ? `<br><span class="muted pequeno">resp.: ${h(p.responsavel_nome)}</span>` : ''}</td>
      <td><span class="pill ${p.status}">${p.status}</span>${p.status === 'confirmado' && !p.pin_hash ? ' <span class="pill recusado">sem PIN</span>' : ''}</td>
      <td class="esconde-cel">${p.foto ? '<span class="ok">✓</span>' : '<span class="falta">·</span>'}</td>
      <td class="esconde-cel">${p.n_sugestoes ? `<span class="ok">${p.n_sugestoes}</span>` : '<span class="falta">0</span>'}</td>
      <td class="esconde-cel">${sorteada ? (p.revelado_em ? '<span class="ok">raspou</span>' : '<span class="falta">·</span>') : (p.convite_enviado_em ? '<span class="ok">enviado</span>' : '<span class="falta">·</span>')}</td>
      <td style="white-space:nowrap">
        <a class="btn wa mini" href="${h(wa)}" target="_blank" rel="noopener noreferrer" data-marcar="/admin/edicoes/${e.id}/convite/${p.id}" ${tel ? '' : 'title="Sem telefone cadastrado: o WhatsApp pedirá o contato"'}>${sorteada ? 'Avisar' : 'Convite'}</a>
        <button class="btn sec mini" data-copiar="${h(link)}">Copiar link</button>
      </td>
      <td>
        <details><summary class="pequeno">mais</summary>
          ${!sorteada ? `
          <form method="post" action="/admin/edicoes/${e.id}/participacoes/${p.id}/status" class="acoes" style="margin-top:6px">
            <select name="status" style="width:auto;padding:6px 8px;font-size:13px">
              <option value="pendente">pendente</option><option value="recusado">recusado</option>
              ${p.pin_hash ? '<option value="confirmado">confirmado</option>' : ''}
            </select><button class="btn sec mini">Alterar</button>
          </form>
          <form method="post" action="/admin/edicoes/${e.id}/participacoes/${p.id}/remover" data-confirmar="Remover ${h(p.nome)} desta edição?"><button class="btn sec mini">Remover da edição</button></form>` : ''}
          ${p.pin_hash ? `<form method="post" action="/admin/edicoes/${e.id}/participacoes/${p.id}/resetar-pin" data-confirmar="Redefinir o PIN de ${h(p.nome)}? A pessoa será avisada na página dela."><button class="btn sec mini">Redefinir PIN</button></form>` : ''}
          <a class="pequeno" href="/admin/pessoas/${p.pessoa_id}">Editar cadastro</a>
        </details>
      </td></tr>`;
  }).join('');

  const corpo = `
  <section class="cartao">
    <h2>${h(e.nome)}</h2>
    <div class="fatos">
      <div class="fato"><b>Confirmados</b><span>${c.confirmados}</span></div>
      <div class="fato"><b>Pendentes</b><span>${c.pendentes}</span></div>
      <div class="fato"><b>Recusaram</b><span>${c.recusados}</span></div>
      <div class="fato"><b>Sorteio</b><span>${h(s.formatar(e.sorteio_em))}</span></div>
      <div class="fato"><b>Situação</b><span>${sorteada ? 'sorteada em ' + h(s.formatar(e.sorteado_em)) : 'inscrições abertas'}</span></div>
    </div>
    ${e.ultimo_erro && !sorteada ? `<div class="aviso erro">Sorteio automático não executado: ${h(e.ultimo_erro)}</div>` : ''}
    ${semPin ? `<div class="aviso info">${semPin} confirmado(s) sem PIN ficarão fora do sorteio até criarem um novo PIN.</div>` : ''}
  </section>

  <section class="cartao">
    <h2>Sorteio</h2>
    ${sorteada ? `
      <p class="ok">Sorteio realizado em ${h(s.formatar(e.sorteado_em))}: ciclo único com todos os confirmados.
      ${e.repeticoes ? `Atenção: ${e.repeticoes} par(es) repetido(s) do ano anterior (não havia alternativa).` : 'Nenhum par repetido do ano anterior.'}</p>
      <p class="muted">Os pares são sigilosos e não aparecem neste painel. Use o botão "Avisar" de cada participante para enviar o link da raspadinha.</p>
      <div class="acoes">
        ${quem ? `<div class="fato"><b>Quem começa a entrega</b><span>${h(quem.nome)}</span></div>` : ''}
        <form method="post" action="/admin/edicoes/${e.id}/quem-comeca" ${quem ? 'data-confirmar="Sortear de novo quem começa?"' : ''}><button class="btn">${quem ? 'Sortear de novo quem começa' : '🎲 Sortear quem começa a entrega'}</button></form>
      </div>
      <details style="margin-top:18px"><summary>Anular o sorteio (emergência)</summary>
        <p class="muted pequeno">Use só se alguém desistir depois do sorteio: o ciclo precisa ser refeito. Todos terão de raspar de novo.</p>
        <form method="post" action="/admin/edicoes/${e.id}/anular"><input type="text" name="confirma" placeholder="Digite ANULAR" style="max-width:200px"> <button class="btn sec">Anular</button></form>
      </details>` : `
      <p>O sorteio roda <b>automaticamente</b> na data marcada, com quem estiver confirmado e com PIN. Pendentes ficam de fora.</p>
      ${sim ? `<div class="aviso ${sim.ok ? 'ok' : 'erro'}">${sim.ok
        ? `Simulação: ciclo único com ${sim.participantes} participantes; ${sim.historico ? `${sim.repeticoes} repetição(ões) do ano anterior` : 'sem histórico anterior a considerar'}. Nenhum par foi gravado nem exibido.`
        : h(sim.motivo)}</div>` : ''}
      <div class="acoes">
        <form method="post" action="/admin/edicoes/${e.id}/simular"><button class="btn sec">Simular (sem gravar)</button></form>
        <form method="post" action="/admin/edicoes/${e.id}/sortear" data-confirmar="Executar o sorteio AGORA com ${c.confirmados} confirmado(s)? Quem estiver pendente ficará de fora."><button class="btn">Sortear agora</button></form>
      </div>`}
  </section>

  <section class="cartao">
    <h2>Participantes (${parts.length})</h2>
    <div class="rolagem"><table>
      <tr><th></th><th>Nome</th><th>Situação</th><th class="esconde-cel">Foto</th><th class="esconde-cel">Sugestões</th><th class="esconde-cel">${sorteada ? 'Raspadinha' : 'Convite'}</th><th>Enviar</th><th></th></tr>
      ${linhas}
    </table></div>
    ${!sorteada ? `<div class="acoes">
      ${fora.length ? `<form method="post" action="/admin/edicoes/${e.id}/incluir" class="acoes" style="margin:0">
        <select name="pessoa_id" style="width:auto">${fora.map((p) => `<option value="${p.id}">${h(p.nome)}</option>`).join('')}</select>
        <button class="btn sec">Incluir pessoa</button></form>` : ''}
      <form method="post" action="/admin/edicoes/${e.id}/incluir-grupo"><button class="btn sec">Incluir todo o grupo</button></form>
      <a class="btn sec" href="/admin/pessoas">Cadastrar nova pessoa</a>
    </div>` : ''}
  </section>

  ${indic.length ? `<section class="cartao">
    <h2>Indicações recebidas</h2>
    <table>${indic.map((i) => `<tr>
      <td><b>${h(i.nome)}</b><br><span class="muted pequeno">${h(i.telefone || 'sem telefone')} · indicado por ${h(i.por || '?')}${i.observacao ? ' · ' + h(i.observacao) : ''}</span></td>
      <td style="white-space:nowrap">
        <form method="post" action="/admin/indicacoes/${i.id}/aceitar" style="display:inline"><button class="btn verde mini">Aceitar</button></form>
        <form method="post" action="/admin/indicacoes/${i.id}/descartar" style="display:inline"><button class="btn sec mini">Descartar</button></form>
      </td></tr>`).join('')}</table>
    <p class="muted pequeno">Ao aceitar, a pessoa é cadastrada, entra no grupo e nesta edição. Se for criança, depois indique o responsável no cadastro dela.</p>
  </section>` : ''}

  <section class="cartao">
    <h2>Datas, valores e mensagem</h2>
    <form method="post" action="/admin/edicoes/${e.id}/config">
      <div class="grade-2">
        <div><label>Nome da edição</label><input type="text" name="nome" value="${h(e.nome)}" required></div>
        <div><label>Local da entrega</label><input type="text" name="entrega_local" value="${h(e.entrega_local)}" placeholder="Ex.: casa dos avós"></div>
        <div><label>Prazo para confirmar</label><input type="datetime-local" name="prazo_confirmacao" value="${s.paraCampoLocal(e.prazo_confirmacao)}"></div>
        <div><label>Prazo para sugestões</label><input type="datetime-local" name="prazo_sugestoes" value="${s.paraCampoLocal(e.prazo_sugestoes)}"></div>
        <div><label>Sorteio automático</label><input type="datetime-local" name="sorteio_em" value="${s.paraCampoLocal(e.sorteio_em)}" ${sorteada ? 'disabled' : ''}></div>
        <div><label>Entrega dos presentes</label><input type="datetime-local" name="entrega_em" value="${s.paraCampoLocal(e.entrega_em)}"></div>
        <div><label>Valor mínimo (R$)</label><input type="number" step="0.01" min="0" name="valor_min" value="${e.valor_min ?? ''}"></div>
        <div><label>Valor máximo (R$)</label><input type="number" step="0.01" min="0" name="valor_max" value="${e.valor_max ?? ''}"></div>
      </div>
      <label>Mensagem para os participantes</label>
      <textarea name="mensagem" maxlength="600">${h(e.mensagem)}</textarea>
      <p class="muted pequeno">Horários de Brasília. O sorteio automático deve ficar depois dos prazos.</p>
      <div class="acoes"><button class="btn">Salvar</button></div>
    </form>
  </section>

  <section class="cartao">
    <h3>Registro de atividades</h3>
    <div class="registro">${registro.map((x) => `<div>${h(s.formatar(x.em + 'Z'))} · ${h(x.evento)}</div>`).join('') || 'Sem registros.'}</div>
  </section>`;

  tela(req, res, { titulo: e.nome, corpo, ativo: '/admin' });
});

r.post('/admin/edicoes/:id/config', carregarEdicao, (req, res) => {
  const e = req.edicao;
  const b = req.body;
  const num = (v) => (v === '' || v === undefined ? null : Number(v));
  const vmin = num(b.valor_min);
  const vmax = num(b.valor_max);
  if (vmin !== null && vmax !== null && vmin > vmax) return volta(res, `/admin/edicoes/${e.id}`, 'O valor mínimo é maior que o máximo.', true);
  const sorteio = e.status === 'sorteada' ? e.sorteio_em : s.deCampoLocal(b.sorteio_em);
  const prazoC = s.deCampoLocal(b.prazo_confirmacao);
  const prazoS = s.deCampoLocal(b.prazo_sugestoes);
  if (sorteio && ((prazoC && prazoC > sorteio) || (prazoS && prazoS > sorteio))) {
    return volta(res, `/admin/edicoes/${e.id}`, 'Os prazos precisam terminar antes do sorteio.', true);
  }
  db.prepare(`UPDATE edicoes SET nome = ?, entrega_local = ?, prazo_confirmacao = ?, prazo_sugestoes = ?, sorteio_em = ?,
    entrega_em = ?, valor_min = ?, valor_max = ?, mensagem = ?, ultimo_erro = NULL WHERE id = ?`)
    .run(limpar(b.nome, 80) || e.nome, limpar(b.entrega_local, 120) || null, prazoC, prazoS, sorteio,
      s.deCampoLocal(b.entrega_em), vmin, vmax, limpar(b.mensagem, 600) || null, e.id);
  log(e.id, 'Configurações da edição atualizadas.');
  volta(res, `/admin/edicoes/${e.id}`, 'Configurações salvas.');
});

r.post('/admin/edicoes/:id/incluir-grupo', carregarEdicao, (req, res) => {
  const n = s.incluirGrupoInteiro(req.edicao.id);
  volta(res, `/admin/edicoes/${req.edicao.id}`, `${n} membro(s) do grupo conferido(s) na edição.`);
});

r.post('/admin/edicoes/:id/incluir', carregarEdicao, (req, res) => {
  if (req.edicao.status === 'sorteada') return volta(res, `/admin/edicoes/${req.edicao.id}`, 'Edição já sorteada.', true);
  s.incluirNaEdicao(req.edicao.id, Number(req.body.pessoa_id));
  volta(res, `/admin/edicoes/${req.edicao.id}`, 'Pessoa incluída.');
});

r.post('/admin/edicoes/:id/convite/:pid', carregarEdicao, (req, res) => {
  db.prepare('UPDATE participacoes SET convite_enviado_em = COALESCE(convite_enviado_em, ?) WHERE id = ? AND edicao_id = ?')
    .run(s.agoraISO(), Number(req.params.pid), req.edicao.id);
  res.json({ ok: true });
});

r.post('/admin/edicoes/:id/participacoes/:pid/status', carregarEdicao, (req, res) => {
  const e = req.edicao;
  const p = s.q.participacao.get(Number(req.params.pid));
  if (!p || p.edicao_id !== e.id || e.status === 'sorteada') return volta(res, `/admin/edicoes/${e.id}`, 'Operação indisponível.', true);
  const st = ['pendente', 'recusado', 'confirmado'].includes(req.body.status) ? req.body.status : 'pendente';
  if (st === 'confirmado' && !p.pin_hash) return volta(res, `/admin/edicoes/${e.id}`, 'Só a própria pessoa pode confirmar, porque precisa criar o PIN.', true);
  db.prepare('UPDATE participacoes SET status = ? WHERE id = ?').run(st, p.id);
  log(e.id, `Organizador alterou ${p.nome} para "${st}".`);
  volta(res, `/admin/edicoes/${e.id}`, 'Situação alterada.');
});

r.post('/admin/edicoes/:id/participacoes/:pid/remover', carregarEdicao, (req, res) => {
  const e = req.edicao;
  if (e.status === 'sorteada') return volta(res, `/admin/edicoes/${e.id}`, 'Edição já sorteada.', true);
  const p = s.q.participacao.get(Number(req.params.pid));
  if (p && p.edicao_id === e.id) {
    db.prepare('DELETE FROM participacoes WHERE id = ?').run(p.id);
    log(e.id, `${p.nome} removido(a) da edição.`);
  }
  volta(res, `/admin/edicoes/${e.id}`, 'Removido da edição.');
});

r.post('/admin/edicoes/:id/participacoes/:pid/resetar-pin', carregarEdicao, (req, res) => {
  const e = req.edicao;
  const p = s.q.participacao.get(Number(req.params.pid));
  if (!p || p.edicao_id !== e.id) return volta(res, `/admin/edicoes/${e.id}`, 'Participante não encontrado.', true);
  db.prepare('UPDATE participacoes SET pin_hash = NULL, pin_tentativas = 0, pin_bloqueio_ate = NULL, pin_redefinido_em = ? WHERE id = ?').run(s.agoraISO(), p.id);
  log(e.id, `PIN de ${p.nome} redefinido pelo organizador.`);
  volta(res, `/admin/edicoes/${e.id}`, `PIN de ${p.nome} apagado. Envie o link de novo para a pessoa criar outro.`);
});

r.post('/admin/edicoes/:id/simular', carregarEdicao, (req, res) => {
  let sim;
  try { sim = s.simular(req.edicao.id); } catch (err) { sim = { ok: false, motivo: err.message }; }
  res.redirect(303, `/admin/edicoes/${req.edicao.id}?sim=${Buffer.from(JSON.stringify(sim)).toString('base64url')}`);
});

r.post('/admin/edicoes/:id/sortear', carregarEdicao, (req, res) => {
  try {
    const r2 = s.executarSorteio(req.edicao.id, 'organizador');
    volta(res, `/admin/edicoes/${req.edicao.id}`, `Sorteio realizado com ${r2.participantes} participantes. Agora envie os avisos.`);
  } catch (err) {
    volta(res, `/admin/edicoes/${req.edicao.id}`, err.message, true);
  }
});

r.post('/admin/edicoes/:id/anular', carregarEdicao, (req, res) => {
  if (req.body.confirma !== 'ANULAR') return volta(res, `/admin/edicoes/${req.edicao.id}`, 'Digite ANULAR para confirmar.', true);
  s.anularSorteio(req.edicao.id);
  volta(res, `/admin/edicoes/${req.edicao.id}`, 'Sorteio anulado. Ajuste os participantes e sorteie de novo.');
});

r.post('/admin/edicoes/:id/quem-comeca', carregarEdicao, (req, res) => {
  try {
    const p = s.sortearQuemComeca(req.edicao.id);
    volta(res, `/admin/edicoes/${req.edicao.id}`, `${p.nome} começa a entrega!`);
  } catch (err) {
    volta(res, `/admin/edicoes/${req.edicao.id}`, err.message, true);
  }
});

r.post('/admin/indicacoes/:iid/:acao', (req, res) => {
  const i = db.prepare('SELECT * FROM indicacoes WHERE id = ?').get(Number(req.params.iid));
  if (!i) return res.redirect(303, '/admin');
  const e = s.q.edicao.get(i.edicao_id);
  if (req.params.acao === 'aceitar') {
    db.transaction(() => {
      const pid = db.prepare('INSERT INTO pessoas (nome, telefone, observacao) VALUES (?, ?, ?)').run(i.nome, i.telefone, i.observacao).lastInsertRowid;
      db.prepare('INSERT OR IGNORE INTO grupo_membros (grupo_id, pessoa_id) VALUES (?, ?)').run(e.grupo_id, pid);
      if (e.status !== 'sorteada') s.incluirNaEdicao(e.id, pid);
      db.prepare("UPDATE indicacoes SET status = 'aceita' WHERE id = ?").run(i.id);
    })();
    log(e.id, `Indicação aceita: ${i.nome}.`);
    return volta(res, `/admin/edicoes/${e.id}`, `${i.nome} cadastrado(a). Envie o convite.`);
  }
  db.prepare("UPDATE indicacoes SET status = 'descartada' WHERE id = ?").run(i.id);
  volta(res, `/admin/edicoes/${e.id}`, 'Indicação descartada.');
});

/* ------------------------------------------------------------------ */
/* Pessoas                                                              */
/* ------------------------------------------------------------------ */
function formPessoa(p, todas, grupos, membros) {
  return `
    <div class="grade-2">
      <div><label>Nome</label><input type="text" name="nome" value="${h(p?.nome)}" required maxlength="80"></div>
      <div><label>Responsável (para crianças)</label>
        <select name="responsavel_id"><option value="">Nenhum (tem o próprio contato)</option>
          ${todas.filter((x) => !p || x.id !== p.id).map((x) => `<option value="${x.id}" ${p?.responsavel_id === x.id ? 'selected' : ''}>${h(x.nome)}</option>`).join('')}
        </select></div>
      <div><label>WhatsApp</label><input type="tel" name="telefone" value="${h(p?.telefone)}" placeholder="(21) 99999-9999"></div>
      <div><label>E-mail</label><input type="email" name="email" value="${h(p?.email)}"></div>
    </div>
    <label>Grupos e núcleo familiar</label>
    ${grupos.map((g) => {
      const m = membros.find((x) => x.grupo_id === g.id);
      return `<div class="acoes" style="margin-top:6px;align-items:center">
        <label style="margin:0;font-weight:400"><input type="checkbox" name="grupo_${g.id}" value="1" ${m ? 'checked' : ''}> ${h(g.nome)}</label>
        <input type="text" name="nucleo_${g.id}" value="${h(m?.nucleo)}" placeholder="Núcleo (ex.: Família 2: Fulano)" style="max-width:340px">
      </div>`;
    }).join('')}
    <label>Observação interna</label><input type="text" name="observacao" value="${h(p?.observacao)}" maxlength="200">`;
}

function salvarMembros(pessoaId, body, grupos) {
  for (const g of grupos) {
    if (body[`grupo_${g.id}`]) {
      db.prepare(`INSERT INTO grupo_membros (grupo_id, pessoa_id, nucleo) VALUES (?, ?, ?)
        ON CONFLICT(grupo_id, pessoa_id) DO UPDATE SET nucleo = excluded.nucleo`).run(g.id, pessoaId, limpar(body[`nucleo_${g.id}`], 80) || null);
    } else {
      db.prepare('DELETE FROM grupo_membros WHERE grupo_id = ? AND pessoa_id = ?').run(g.id, pessoaId);
    }
  }
}

r.get('/admin/pessoas', (req, res) => {
  const todas = db.prepare(`SELECT p.*, r.nome AS responsavel_nome,
      (SELECT GROUP_CONCAT(COALESCE(gm.nucleo, g.nome), ' / ') FROM grupo_membros gm JOIN grupos g ON g.id = gm.grupo_id WHERE gm.pessoa_id = p.id) AS grupos
    FROM pessoas p LEFT JOIN pessoas r ON r.id = p.responsavel_id ORDER BY alfa(p.nome)`).all();
  const grupos = db.prepare('SELECT * FROM grupos ORDER BY alfa(nome)').all();
  tela(req, res, {
    titulo: 'Pessoas', ativo: '/admin/pessoas',
    corpo: `
    <section class="cartao">
      <h2>Pessoas (${todas.length})</h2>
      <div class="rolagem"><table>
        <tr><th></th><th>Nome</th><th>Contato</th><th class="esconde-cel">Grupo / núcleo</th></tr>
        ${todas.map((p) => `<tr>
          <td>${avatar(p.foto, p.nome, 'ini')}</td>
          <td><a href="/admin/pessoas/${p.id}"><b>${h(p.nome)}</b></a></td>
          <td>${p.responsavel_id ? `<span class="muted">via ${h(p.responsavel_nome)}</span>` : h(p.telefone || '') || '<span class="falta">sem telefone</span>'}</td>
          <td class="esconde-cel muted pequeno">${h(p.grupos || '')}</td></tr>`).join('')}
      </table></div>
    </section>
    <section class="cartao">
      <h2>Cadastrar pessoa</h2>
      <form method="post" action="/admin/pessoas">${formPessoa(null, todas, grupos, grupos.map((g) => ({ grupo_id: g.id })))}
        <div class="acoes"><button class="btn">Cadastrar</button></div></form>
    </section>`,
  });
});

r.post('/admin/pessoas', (req, res) => {
  const b = req.body;
  const nome = limpar(b.nome, 80);
  if (!nome) return volta(res, '/admin/pessoas', 'Informe o nome.', true);
  const grupos = db.prepare('SELECT * FROM grupos').all();
  const id = db.prepare('INSERT INTO pessoas (nome, telefone, email, responsavel_id, observacao) VALUES (?, ?, ?, ?, ?)')
    .run(nome, limpar(b.telefone, 30) || null, limpar(b.email, 120) || null, Number(b.responsavel_id) || null, limpar(b.observacao) || null).lastInsertRowid;
  salvarMembros(id, b, grupos);
  // Entra automaticamente nas edições abertas dos grupos marcados
  const abertas = db.prepare(`SELECT e.id FROM edicoes e JOIN grupo_membros gm ON gm.grupo_id = e.grupo_id
    WHERE gm.pessoa_id = ? AND e.status = 'aberta'`).all(id);
  abertas.forEach((e) => s.incluirNaEdicao(e.id, id));
  volta(res, '/admin/pessoas', `${nome} cadastrado(a)${abertas.length ? ' e incluído(a) na edição aberta' : ''}.`);
});

r.get('/admin/pessoas/:pid', (req, res) => {
  const p = db.prepare('SELECT * FROM pessoas WHERE id = ?').get(Number(req.params.pid));
  if (!p) return res.redirect(303, '/admin/pessoas');
  const todas = db.prepare('SELECT id, nome FROM pessoas ORDER BY alfa(nome)').all();
  const grupos = db.prepare('SELECT * FROM grupos ORDER BY alfa(nome)').all();
  const membros = db.prepare('SELECT * FROM grupo_membros WHERE pessoa_id = ?').all(p.id);
  const deps = db.prepare('SELECT nome FROM pessoas WHERE responsavel_id = ?').all(p.id);
  tela(req, res, {
    titulo: p.nome, ativo: '/admin/pessoas', scripts: ['/convite.js'],
    corpo: `
    <section class="cartao">
      <div class="foto-linha">${avatar(p.foto, p.nome)}
        <div><label class="btn sec mini" style="margin:0">Trocar foto<input type="file" accept="image/*" id="foto-input" data-admin="${p.id}" hidden></label>
        <div id="foto-status" class="muted pequeno"></div></div></div>
      ${deps.length ? `<p class="muted">Responsável por: ${deps.map((d) => h(d.nome)).join(', ')}</p>` : ''}
      <form method="post" action="/admin/pessoas/${p.id}">${formPessoa(p, todas, grupos, membros)}
        <div class="acoes"><button class="btn">Salvar</button></div></form>
    </section>
    <section class="cartao">
      <details><summary>Excluir cadastro</summary>
        <p class="muted pequeno">Apaga a pessoa e as participações em edições não sorteadas. Não é possível excluir quem está em edição já sorteada.</p>
        <form method="post" action="/admin/pessoas/${p.id}/excluir" data-confirmar="Excluir ${h(p.nome)} definitivamente?"><button class="btn sec">Excluir</button></form>
      </details>
    </section>`,
  });
});

r.post('/admin/pessoas/:pid', (req, res) => {
  const id = Number(req.params.pid);
  const b = req.body;
  const resp = Number(b.responsavel_id) || null;
  if (resp === id) return volta(res, `/admin/pessoas/${id}`, 'A pessoa não pode ser responsável por si mesma.', true);
  db.prepare('UPDATE pessoas SET nome = ?, telefone = ?, email = ?, responsavel_id = ?, observacao = ? WHERE id = ?')
    .run(limpar(b.nome, 80), limpar(b.telefone, 30) || null, limpar(b.email, 120) || null, resp, limpar(b.observacao) || null, id);
  salvarMembros(id, b, db.prepare('SELECT * FROM grupos').all());
  volta(res, `/admin/pessoas/${id}`, 'Cadastro salvo.');
});

r.post('/admin/pessoas/:pid/foto', upload.single('foto'), (req, res) => {
  try {
    const nome = salvarFoto(Number(req.params.pid), req.file);
    res.json({ ok: true, foto: `/fotos/${nome}` });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

r.post('/admin/pessoas/:pid/excluir', (req, res) => {
  const id = Number(req.params.pid);
  const sorteada = db.prepare(`SELECT 1 FROM participacoes p JOIN edicoes e ON e.id = p.edicao_id
    WHERE p.pessoa_id = ? AND e.status = 'sorteada'`).get(id);
  if (sorteada) return volta(res, `/admin/pessoas/${id}`, 'Esta pessoa está em edição já sorteada; o histórico precisa ser preservado.', true);
  db.prepare('DELETE FROM pessoas WHERE id = ?').run(id);
  volta(res, '/admin/pessoas', 'Cadastro excluído.');
});

/* ------------------------------------------------------------------ */
/* Grupos                                                               */
/* ------------------------------------------------------------------ */
r.get('/admin/grupos', (req, res) => {
  const grupos = db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM grupo_membros m WHERE m.grupo_id = g.id) AS n FROM grupos g ORDER BY alfa(nome)`).all();
  tela(req, res, {
    titulo: 'Grupos', ativo: '/admin/grupos',
    corpo: `
    <section class="cartao">
      <h2>Grupos</h2>
      <table>${grupos.map((g) => `<tr><td><b>${h(g.nome)}</b></td><td>${g.n} pessoa(s)</td></tr>`).join('')}</table>
      <p class="muted pequeno">Para pôr alguém num grupo, abra o cadastro da pessoa.</p>
    </section>
    <section class="cartao">
      <h2>Novo grupo</h2>
      <form method="post" action="/admin/grupos" class="acoes"><input type="text" name="nome" required placeholder="Ex.: Trabalho" style="max-width:320px"><button class="btn">Criar</button></form>
    </section>`,
  });
});

r.post('/admin/grupos', (req, res) => {
  const nome = limpar(req.body.nome, 60);
  if (!nome) return volta(res, '/admin/grupos', 'Informe o nome.', true);
  try { db.prepare('INSERT INTO grupos (nome) VALUES (?)').run(nome); } catch { return volta(res, '/admin/grupos', 'Já existe um grupo com esse nome.', true); }
  volta(res, '/admin/grupos', 'Grupo criado.');
});

module.exports = r;
