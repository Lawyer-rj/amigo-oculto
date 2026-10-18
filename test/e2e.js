'use strict';
// Teste ponta a ponta contra um servidor em execução (BASE, padrão http://localhost:3000).
// Simula os 20 convidados: confirmação com PIN, sugestões, foto; depois o sorteio
// e a revelação de cada um, conferindo que o resultado forma um ciclo único.
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3000';
const SENHA = process.env.ADMIN_SENHA || 'admin';

async function main() {
  // Login do organizador
  let r = await fetch(`${BASE}/admin/entrar`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ senha: SENHA }),
  });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const adm = (p, opt = {}) => fetch(BASE + p, { ...opt, redirect: 'manual', headers: { ...(opt.headers || {}), cookie } });

  // Página da edição: extrai links pessoais
  let html = await (await adm('/admin/edicoes/1')).text();
  const tokens = [...new Set([...html.matchAll(/\/c\/([A-Za-z0-9_-]{22})/g)].map((m) => m[1]))];
  assert.strictEqual(tokens.length, 20, `esperava 20 links, achei ${tokens.length}`);
  assert.ok(!/ tirou /i.test(html));

  // Sem sessão, o painel não abre
  r = await fetch(`${BASE}/admin/edicoes/1`, { redirect: 'manual' });
  assert.strictEqual(r.status, 303);

  const form = (t, p, dados) => fetch(`${BASE}/c/${t}/${p}`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...dados, pin_atual: String(1000 + tokens.indexOf(t)) }),
  });

  // PIN inválido é rejeitado
  r = await form(tokens[0], 'confirmar', { resposta: 'confirmado', pin: '12', pin2: '12' });
  assert.match(decodeURIComponent(r.headers.get('location')), /4 a 6/);

  // 19 confirmam, 1 recusa (guarda o nome completo de cada link)
  const nomeDe = {};
  const sessoes = {};
  for (let i = 0; i < tokens.length; i++) {
    const pg = await (await fetch(`${BASE}/c/${tokens[i]}`)).text();
    nomeDe[i] = pg.match(/id="nome" name="nome" value="([^"]+)"/)[1];
    const resposta = i === 19 ? 'recusado' : 'confirmado';
    r = await form(tokens[i], 'confirmar', { resposta, pin: String(1000 + i), pin2: String(1000 + i) });
    assert.strictEqual(r.status, 303);
    if(resposta==='confirmado') sessoes[i]=r.headers.get('set-cookie').split(';')[0];
    await form(tokens[i], 'sugestoes', { texto0: `Livro ${i}`, link0: 'loja.com.br/livro', cor0: 'azul', tamanho0: 'M', detalhes0: 'capa dura', onde0: 'Livraria do centro', texto1: `Caneca ${i}`, link1: '', texto2: `Chocolate ${i}` });
  }

  // Foto (PNG mínimo 1x1)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('foto', new Blob([png], { type: 'image/png' }), 'f.png');
  r = await fetch(`${BASE}/c/${tokens[0]}/foto`, { method: 'POST', headers: { 'X-Participant-PIN': '1000' }, body: fd });
  const jf = await r.json();
  assert.ok(jf.ok, JSON.stringify(jf));
  // Arquivo que não é imagem é recusado
  const fd2 = new FormData();
  fd2.append('foto', new Blob(['<script>'], { type: 'image/png' }), 'x.png');
  r = await fetch(`${BASE}/c/${tokens[1]}/foto`, { method: 'POST', headers: { 'X-Participant-PIN': '1001' }, body: fd2 });
  assert.strictEqual(r.status, 400);

  // Revelar antes do sorteio: negado
  r = await fetch(`${BASE}/c/${tokens[0]}/revelar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1000' }) });
  assert.strictEqual(r.status, 400);

  // Simulação não grava nada
  r = await adm('/admin/edicoes/1/simular', { method: 'POST' });
  html = await (await adm(r.headers.get('location'))).text();
  assert.match(html, /Simulação: ciclo único com 19 participantes/);

  // Sorteio
  r = await adm('/admin/edicoes/1/sortear', { method: 'POST' });
  assert.match(decodeURIComponent(r.headers.get('location')), /Sorteio realizado com 19/);
  html = await (await adm('/admin/edicoes/1')).text();
  assert.match(html, /Sorteio realizado em/);

  // PIN errado
  r = await fetch(`${BASE}/c/${tokens[2]}/revelar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '9999' }) });
  assert.strictEqual(r.status, 400);

  // Revela os 19 e reconstrói o ciclo pelos nomes
  const tirou = {};
  for (let i = 0; i < 19; i++) {
    const pag = await (await fetch(`${BASE}/c/${tokens[i]}`,{headers:{cookie:sessoes[i]}})).text();
    assert.match(pag, /raspadinha/);
    r = await fetch(`${BASE}/c/${tokens[i]}/revelar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: String(1000 + i) }) });
    const j = await r.json();
    assert.ok(j.nome, JSON.stringify(j));
    assert.ok(j.sugestoes.length === 3);
    assert.deepStrictEqual([j.sugestoes[0].cor, j.sugestoes[0].tamanho, j.sugestoes[0].detalhes, j.sugestoes[0].onde], ['azul', 'M', 'capa dura', 'Livraria do centro']);
    tirou[i] = j.nome;
  }
  const nomes = Object.values(tirou);
  assert.strictEqual(new Set(nomes).size, 19, 'cada um recebe de exatamente uma pessoa');
  // Quem recusou não aparece
  const recusouPag = await (await fetch(`${BASE}/c/${tokens[19]}`)).text();
  assert.match(recusouPag, /recusada/);
  // Ninguém tirou a si mesmo e o conjunto forma UM ciclo com os 19
  const prox = {};
  for (let i = 0; i < 19; i++) { assert.notStrictEqual(tirou[i], nomeDe[i], 'tirou a si mesmo'); prox[nomeDe[i]] = tirou[i]; }
  let atual = nomeDe[0], passos = 0;
  do { atual = prox[atual]; passos++; } while (atual !== nomeDe[0] && passos < 50);
  assert.strictEqual(passos, 19, 'não formou ciclo único');

  // Quem começa
  r = await adm('/admin/edicoes/1/quem-comeca', { method: 'POST' });
  assert.match(decodeURIComponent(r.headers.get('location')), /começa a entrega/);

  // Painel continua sem pares
  html = await (await adm('/admin/edicoes/1')).text();
  for (const n of nomes) {
    // o nome aparece na lista de participantes, mas nunca em formato "X → Y"
    assert.ok(!html.includes(`→ ${n}`));
  }
  console.log('E2E OK: 20 convidados, 19 confirmados, três sugestões, fotos, sorteio em ciclo, revelações individuais, sigilo do painel.');
}

main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
