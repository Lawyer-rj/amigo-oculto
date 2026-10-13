'use strict';
/**
 * Sorteio em CICLO ÚNICO FECHADO.
 *
 * Todos os participantes formam uma só sequência circular:
 *   A → B → C → ... → A
 * Garante, por construção: ninguém tira a si mesmo; não há subgrupos
 * isolados (nem pares recíprocos A↔B, a partir de 3 pessoas); todos dão e
 * recebem exatamente um presente; a entrega percorre todos sem interrupção.
 *
 * Regra histórica (preferencial): evitar repetir quem tirou quem na edição
 * anterior. Se a busca não encontrar um ciclo sem repetições, escolhe o melhor
 * candidato encontrado; não afirma que a solução é matematicamente ótima.
 */
const crypto = require('crypto');

function embaralhar(lista, rnd = crypto.randomInt) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function contarRepeticoes(ordem, evitar) {
  let n = 0;
  for (let i = 0; i < ordem.length; i++) {
    const de = ordem[i];
    const para = ordem[(i + 1) % ordem.length];
    if (evitar.has(`${de}>${para}`)) n++;
  }
  return n;
}

/**
 * @param {Array<number|string>} ids  participantes (mínimo 3)
 * @param {Array<[any, any]>} historico pares [quem tirou, quem foi tirado] a evitar
 * @returns {{ ordem: any[], pares: Array<[any, any]>, repeticoes: number }}
 */
function sortearCiclo(ids, historico = [], { tentativas = 5000, rnd } = {}) {
  const unicos = [...new Set(ids)];
  if (unicos.length !== ids.length) throw new Error('Há participantes duplicados.');
  if (unicos.length < 3) throw new Error('O sorteio exige pelo menos 3 participantes confirmados.');

  const evitar = new Set(historico.map(([a, b]) => `${a}>${b}`));
  let melhor = null;
  let melhorRep = Infinity;

  for (let t = 0; t < tentativas; t++) {
    const ordem = embaralhar(unicos, rnd);
    const rep = evitar.size ? contarRepeticoes(ordem, evitar) : 0;
    if (rep < melhorRep) {
      melhor = ordem;
      melhorRep = rep;
      if (rep === 0) break;
    }
  }

  const pares = melhor.map((de, i) => [de, melhor[(i + 1) % melhor.length]]);
  return { ordem: melhor, pares, repeticoes: melhorRep };
}

/** Confere se um conjunto de pares forma um único ciclo com todos. */
function eCicloUnico(pares) {
  const prox = new Map(pares);
  if (prox.size !== pares.length) return false;
  const destinos = new Set(pares.map((p) => p[1]));
  if (destinos.size !== pares.length) return false;
  const inicio = pares[0][0];
  let atual = inicio;
  for (let passo = 1; passo <= pares.length; passo++) {
    atual = prox.get(atual);
    if (atual === undefined) return false;
    if (atual === inicio) return passo === pares.length;
  }
  return false;
}

module.exports = { sortearCiclo, eCicloUnico, contarRepeticoes, embaralhar };
