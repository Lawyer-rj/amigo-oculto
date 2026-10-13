'use strict';
const crypto = require('crypto');
const { db, log } = require('./db');
const seg = require('./seguranca');
const { sortearCiclo, eCicloUnico } = require('./sorteio');

const agoraISO = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* Datas: o painel trabalha no horário de Brasília (sem horário de verão) */
/* ------------------------------------------------------------------ */
function deCampoLocal(v) {
  // "2026-12-24T20:00" (horário de Brasília) -> ISO UTC
  if (!v) return null;
  const d = new Date(`${v}:00-03:00`);
  return isNaN(d) ? null : d.toISOString();
}
function paraCampoLocal(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return d.toISOString().slice(0, 16);
}
function formatar(iso, comHora = true) {
  if (!iso) return 'a definir';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}
function passou(iso) {
  return !!iso && new Date(iso).getTime() <= Date.now();
}
function reais(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ------------------------------------------------------------------ */
/* Telefone e WhatsApp                                                  */
/* ------------------------------------------------------------------ */
function normalizarTelefone(t) {
  if (!t) return null;
  let d = String(t).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d; // DDD + número brasileiro
  return d;
}
function linkWhatsApp(telefone, texto) {
  const num = normalizarTelefone(telefone);
  return `https://wa.me/${num || ''}?text=${encodeURIComponent(texto)}`;
}

/* ------------------------------------------------------------------ */
/* Consultas                                                            */
/* ------------------------------------------------------------------ */
const q = {
  edicao: db.prepare('SELECT e.*, g.nome AS grupo_nome FROM edicoes e JOIN grupos g ON g.id = e.grupo_id WHERE e.id = ?'),
  participacaoPorToken: db.prepare(`
    SELECT p.*, pe.nome, pe.telefone, pe.email, pe.foto, pe.responsavel_id
    FROM participacoes p JOIN pessoas pe ON pe.id = p.pessoa_id WHERE p.token = ?`),
  participacao: db.prepare(`
    SELECT p.*, pe.nome, pe.telefone, pe.email, pe.foto, pe.responsavel_id
    FROM participacoes p JOIN pessoas pe ON pe.id = p.pessoa_id WHERE p.id = ?`),
  participantes: db.prepare(`
    SELECT p.*, pe.nome, pe.telefone, pe.email, pe.foto, pe.responsavel_id,
           r.nome AS responsavel_nome, r.telefone AS responsavel_telefone,
           gm.nucleo,
           (SELECT COUNT(*) FROM sugestoes s WHERE s.participacao_id = p.id) AS n_sugestoes
    FROM participacoes p
    JOIN pessoas pe ON pe.id = p.pessoa_id
    JOIN edicoes e ON e.id = p.edicao_id
    LEFT JOIN pessoas r ON r.id = pe.responsavel_id
    LEFT JOIN grupo_membros gm ON gm.pessoa_id = pe.id AND gm.grupo_id = e.grupo_id
    WHERE p.edicao_id = ?
    ORDER BY COALESCE(gm.nucleo, 'zzz'), pe.id`),
  sugestoes: db.prepare('SELECT * FROM sugestoes WHERE participacao_id = ? ORDER BY ordem'),
  dependentesNaEdicao: db.prepare(`
    SELECT p.*, pe.nome, pe.foto FROM participacoes p JOIN pessoas pe ON pe.id = p.pessoa_id
    WHERE p.edicao_id = ? AND pe.responsavel_id = ? ORDER BY alfa(pe.nome)`),
};

function contagens(edicaoId) {
  const r = db.prepare(`
    SELECT
      SUM(status = 'confirmado') AS confirmados,
      SUM(status = 'recusado') AS recusados,
      SUM(status = 'pendente') AS pendentes,
      COUNT(*) AS total
    FROM participacoes WHERE edicao_id = ?`).get(edicaoId);
  return {
    confirmados: r.confirmados || 0, recusados: r.recusados || 0,
    pendentes: r.pendentes || 0, total: r.total || 0,
  };
}

/* ------------------------------------------------------------------ */
/* Inscrição na edição                                                  */
/* ------------------------------------------------------------------ */
function incluirNaEdicao(edicaoId, pessoaId) {
  const existe = db.prepare('SELECT id FROM participacoes WHERE edicao_id = ? AND pessoa_id = ?').get(edicaoId, pessoaId);
  if (existe) return existe.id;
  const r = db.prepare('INSERT INTO participacoes (edicao_id, pessoa_id, token) VALUES (?, ?, ?)')
    .run(edicaoId, pessoaId, seg.token());
  return r.lastInsertRowid;
}

function incluirGrupoInteiro(edicaoId) {
  const e = q.edicao.get(edicaoId);
  const membros = db.prepare('SELECT pessoa_id FROM grupo_membros WHERE grupo_id = ?').all(e.grupo_id);
  const tx = db.transaction(() => membros.forEach((m) => incluirNaEdicao(edicaoId, m.pessoa_id)));
  tx();
  return membros.length;
}

/* ------------------------------------------------------------------ */
/* Histórico: pares da edição sorteada anterior do mesmo grupo (por pessoa) */
/* ------------------------------------------------------------------ */
function paresDaEdicao(edicaoId) {
  const linhas = db.prepare(`
    SELECT pa.participacao_id, pa.destino_cifrado, p.pessoa_id
    FROM pares pa JOIN participacoes p ON p.id = pa.participacao_id WHERE pa.edicao_id = ?`).all(edicaoId);
  const pessoaDe = new Map(
    db.prepare('SELECT id, pessoa_id FROM participacoes WHERE edicao_id = ?').all(edicaoId).map((x) => [x.id, x.pessoa_id]),
  );
  return linhas.map((l) => {
    const destinoPart = Number(seg.decifrar(l.destino_cifrado, l.participacao_id));
    return [l.pessoa_id, pessoaDe.get(destinoPart)];
  });
}

function historicoPara(edicao) {
  const anterior = db.prepare(`
    SELECT id FROM edicoes WHERE grupo_id = ? AND id <> ? AND ano < ? AND status = 'sorteada'
    ORDER BY ano DESC, sorteado_em DESC LIMIT 1`).get(edicao.grupo_id, edicao.id, edicao.ano);
  return anterior ? paresDaEdicao(anterior.id) : [];
}

/* ------------------------------------------------------------------ */
/* Sorteio                                                              */
/* ------------------------------------------------------------------ */
function confirmadosParaSorteio(edicaoId) {
  return db.prepare(`
    SELECT p.id, p.pessoa_id FROM participacoes p
    WHERE p.edicao_id = ? AND p.status = 'confirmado' AND p.pin_hash IS NOT NULL`).all(edicaoId);
}

/** Simulação: roda o algoritmo e devolve só estatísticas (nunca os pares). */
function simular(edicaoId) {
  const e = q.edicao.get(edicaoId);
  const conf = confirmadosParaSorteio(edicaoId);
  if (conf.length < 3) return { ok: false, motivo: `Apenas ${conf.length} confirmado(s); são necessários 3.` };
  const hist = historicoPara(e);
  const r = sortearCiclo(conf.map((c) => c.pessoa_id), hist);
  return {
    ok: eCicloUnico(r.pares),
    participantes: conf.length,
    historico: hist.length,
    repeticoes: r.repeticoes,
  };
}

function executarSorteio(edicaoId, origem = 'organizador') {
  const e = q.edicao.get(edicaoId);
  if (!e) throw new Error('Edição não encontrada.');
  if (e.status === 'sorteada') throw new Error('Esta edição já foi sorteada.');
  const conf = confirmadosParaSorteio(edicaoId);
  if (conf.length < 3) throw new Error(`Apenas ${conf.length} participante(s) confirmado(s); são necessários 3.`);

  const hist = historicoPara(e);
  const partDaPessoa = new Map(conf.map((c) => [c.pessoa_id, c.id]));
  const r = sortearCiclo(conf.map((c) => c.pessoa_id), hist);
  if (!eCicloUnico(r.pares)) throw new Error('Falha de consistência: o resultado não forma ciclo único.');

  const ins = db.prepare('INSERT INTO pares (participacao_id, edicao_id, destino_cifrado) VALUES (?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM pares WHERE edicao_id = ?').run(edicaoId);
    for (const [dePessoa, paraPessoa] of r.pares) {
      const de = partDaPessoa.get(dePessoa);
      const para = partDaPessoa.get(paraPessoa);
      ins.run(de, edicaoId, seg.cifrar(para, de));
    }
    db.prepare(`UPDATE edicoes SET status = 'sorteada', sorteado_em = ?, sorteio_versao = ?, repeticoes = ?, ultimo_erro = NULL, quem_comeca_id = NULL WHERE id = ?`)
      .run(agoraISO(), crypto.randomUUID(), r.repeticoes, edicaoId);
  })();
  log(edicaoId, `Sorteio executado (${origem}): ${conf.length} participantes em ciclo único; repetições do ano anterior: ${r.repeticoes}.`);
  return { participantes: conf.length, repeticoes: r.repeticoes };
}

function anularSorteio(edicaoId) {
  db.transaction(() => {
    db.prepare('DELETE FROM pares WHERE edicao_id = ?').run(edicaoId);
    db.prepare(`UPDATE edicoes SET status = 'aberta', sorteio_em = NULL, sorteado_em = NULL, sorteio_versao = NULL, repeticoes = NULL, quem_comeca_id = NULL, ultimo_erro = NULL WHERE id = ?`).run(edicaoId);
    db.prepare('UPDATE participacoes SET revelado_em = NULL, presente_comprado_em = NULL WHERE edicao_id = ?').run(edicaoId);
  })();
  log(edicaoId, 'Sorteio ANULADO pelo organizador.');
}

function sortearQuemComeca(edicaoId) {
  const e = q.edicao.get(edicaoId);
  if (e.status !== 'sorteada') throw new Error('Faça primeiro o sorteio principal.');
  const ids = db.prepare('SELECT participacao_id FROM pares WHERE edicao_id = ?').all(edicaoId).map((x) => x.participacao_id);
  const escolhido = ids[crypto.randomInt(ids.length)];
  db.prepare('UPDATE edicoes SET quem_comeca_id = ? WHERE id = ?').run(escolhido, edicaoId);
  const p = q.participacao.get(escolhido);
  log(edicaoId, `Sorteado quem começa a entrega: ${p.nome}.`);
  return p;
}

/** Resultado de um participante: só depois do sorteio e com o PIN correto. */
function revelar(participacao, pin) {
  const e = q.edicao.get(participacao.edicao_id);
  if (e.status !== 'sorteada') return { erro: 'O sorteio ainda não foi realizado.' };
  if (participacao.pin_bloqueio_ate && new Date(participacao.pin_bloqueio_ate) > new Date()) {
    return { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' };
  }
  if (!seg.confereHash(String(pin || ''), participacao.pin_hash)) {
    const t = participacao.pin_tentativas + 1;
    const bloqueio = t >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
    db.prepare('UPDATE participacoes SET pin_tentativas = ?, pin_bloqueio_ate = ? WHERE id = ?')
      .run(bloqueio ? 0 : t, bloqueio, participacao.id);
    return { erro: bloqueio ? 'PIN incorreto. Acesso bloqueado por 15 minutos.' : `PIN incorreto (${5 - t} tentativa(s) restante(s)).` };
  }
  const par = db.prepare('SELECT destino_cifrado FROM pares WHERE participacao_id = ?').get(participacao.id);
  if (!par) return { erro: 'Você não participou deste sorteio (confirmação fora do prazo).' };
  const destino = q.participacao.get(Number(seg.decifrar(par.destino_cifrado, participacao.id)));
  db.prepare('UPDATE participacoes SET pin_tentativas = 0, pin_bloqueio_ate = NULL, revelado_em = COALESCE(revelado_em, ?) WHERE id = ?')
    .run(agoraISO(), participacao.id);
  return {
    nome: destino.nome,
    foto: destino.foto ? `/fotos/${destino.foto}` : null,
    sugestoes: q.sugestoes.all(destino.id).map((s) => ({
      texto: s.texto, link: s.link, onde: s.onde, cor: s.cor, tamanho: s.tamanho, detalhes: s.detalhes,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Agendador interno: executa sorteios vencidos                         */
/* ------------------------------------------------------------------ */
function verificarAgendados() {
  const vencidas = db.prepare(`
    SELECT id FROM edicoes WHERE status = 'aberta' AND sorteio_em IS NOT NULL AND sorteio_em <= ?`).all(agoraISO());
  for (const { id } of vencidas) {
    try {
      executarSorteio(id, 'automático');
      console.log(`[agendador] edição ${id} sorteada`);
    } catch (err) {
      const anterior = q.edicao.get(id).ultimo_erro;
      if (anterior !== err.message) {
        db.prepare('UPDATE edicoes SET ultimo_erro = ? WHERE id = ?').run(err.message, id);
        log(id, `Sorteio automático não executado: ${err.message}`);
      }
    }
  }
}
function iniciarAgendador() {
  setTimeout(verificarAgendados, 3000);
  setInterval(verificarAgendados, 60_000).unref();
}

module.exports = {
  q, contagens, incluirNaEdicao, incluirGrupoInteiro, simular, executarSorteio, anularSorteio,
  sortearQuemComeca, revelar, iniciarAgendador, verificarAgendados,
  deCampoLocal, paraCampoLocal, formatar, passou, reais, normalizarTelefone, linkWhatsApp, agoraISO,
};
