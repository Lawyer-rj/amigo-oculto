'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sortearCiclo, eCicloUnico } = require('../src/sorteio');

const vinte = Array.from({ length: 20 }, (_, i) => i + 1);

test('20 participantes: sempre um ciclo único, sem autoatribuição', () => {
  for (let k = 0; k < 2000; k++) {
    const { pares } = sortearCiclo(vinte);
    assert.strictEqual(pares.length, 20);
    assert.ok(eCicloUnico(pares));
    for (const [a, b] of pares) assert.notStrictEqual(a, b);
  }
});

test('nunca há par recíproco isolado (A→B e B→A) com 3 ou mais', () => {
  for (const n of [3, 4, 5, 20]) {
    const ids = Array.from({ length: n }, (_, i) => i);
    for (let k = 0; k < 500; k++) {
      const { pares } = sortearCiclo(ids);
      const s = new Set(pares.map(([a, b]) => `${a}>${b}`));
      for (const [a, b] of pares) assert.ok(!s.has(`${b}>${a}`), `recíproco em n=${n}`);
    }
  }
});

test('regra histórica: com 20 pessoas, nunca repete o ano anterior', () => {
  for (let k = 0; k < 500; k++) {
    const anterior = sortearCiclo(vinte).pares;
    const { pares, repeticoes } = sortearCiclo(vinte, anterior);
    assert.strictEqual(repeticoes, 0);
    const ant = new Set(anterior.map(([a, b]) => `${a}>${b}`));
    for (const [a, b] of pares) assert.ok(!ant.has(`${a}>${b}`));
  }
});

test('regra histórica com participantes novos e ausentes', () => {
  const anterior = sortearCiclo(vinte).pares;
  const agora = [...vinte.slice(2), 21, 22];
  const { pares, repeticoes } = sortearCiclo(agora, anterior);
  assert.ok(eCicloUnico(pares));
  assert.strictEqual(repeticoes, 0);
});

test('grupo mínimo: se não houver como evitar repetição, minimiza e não trava', () => {
  // Com 3 pessoas só existem 2 ciclos; proibindo arcos dos dois, ainda sorteia.
  const hist = [[1, 2], [2, 3], [3, 1], [1, 3]];
  const r = sortearCiclo([1, 2, 3], hist);
  assert.ok(eCicloUnico(r.pares));
  assert.ok(r.repeticoes >= 1);
});

test('rejeita menos de 3 e duplicados', () => {
  assert.throws(() => sortearCiclo([1, 2]));
  assert.throws(() => sortearCiclo([1, 1, 2]));
});

test('distribuição: cada pessoa tira cada outra com frequência parecida', () => {
  const ids = [1, 2, 3, 4, 5];
  const cont = {};
  const N = 20000;
  for (let k = 0; k < N; k++) {
    for (const [a, b] of sortearCiclo(ids).pares) cont[`${a}>${b}`] = (cont[`${a}>${b}`] || 0) + 1;
  }
  // Em ciclo único de 5, cada um tira cada um dos outros 4 com probabilidade 1/4.
  for (const v of Object.values(cont)) assert.ok(Math.abs(v / N - 0.25) < 0.02, String(v / N));
});
