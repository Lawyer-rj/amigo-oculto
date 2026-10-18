'use strict';
const express = require('express');
const { db, log } = require('./db');
const seg = require('./seguranca');
const recuperacao = require('./recuperacao');
const social = require('./interacoes');
const sessoes = require('./sessoes');
const email = require('./email');
const s = require('./servico');
const { upload, salvarFoto } = require('./fotos');
const { h, pagina, avatar, aviso } = require('./layout');

const r = express.Router();

function carregar(req, res, next) {
  const p = s.q.participacaoPorToken.get(req.params.token);
  if (!p) {
    return res.status(404).send(pagina({
      titulo: 'Link inválido',
      corpo: '<div class="cartao"><h2>Link não encontrado</h2><p>Confira se o link foi copiado inteiro ou peça um novo ao organizador.</p></div>',
    }));
  }
  req.part = p;
  req.edicao = s.q.edicao.get(p.edicao_id);
  next();
}

const voltar = (res, token, msg, erro = false) =>
  res.redirect(303, `/c/${token}?${erro ? 'erro' : 'ok'}=${encodeURIComponent(msg)}`);

function campoAcesso(req, identificador) {
  if (!req.part.pin_hash) return '';
  const sessao = social.sessaoParticipante(req);
  if (sessao) return `<input type="hidden" name="csrf" value="${h(sessao.csrf)}">`;
  return `<label for="pin-${identificador}">Seu PIN para salvar</label><input id="pin-${identificador}" type="password" name="pin_atual" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="current-password">`;
}
function protegerAlteracao(req, res, next) {
  if (!req.part.pin_hash) return next();
  const sessao = social.sessaoParticipante(req);
  if (sessao) {
    if ((req.body?.csrf || req.get('X-CSRF-Token')) !== sessao.csrf) return res.status(403).send('Atualize a página e tente novamente.');
    return next();
  }
  const erro = recuperacao.validar(req.part, req.body?.pin_atual || req.get('X-Participant-PIN'), 'pin');
  if (!erro) { sessoes.criar(res, req.part); return next(); }
  if (req.path.endsWith('/foto')) return res.status(403).json({ ok: false, erro });
  return voltar(res, req.part.token, erro, true);
}

const limpar = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const urlValida = (u) => {
  if (!u) return null;
  let v = String(u).trim().slice(0, 500);
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const x = new URL(v); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null; } catch { return null; }
};

/* ------------------------------------------------------------------ */
r.get('/c/:token', carregar, (req, res) => {
  const p = req.part;
  const e = req.edicao;
  const sorteada = e.status === 'sorteada';
  const prazoConfPassou = s.passou(e.prazo_confirmacao) || sorteada;
  const prazoSugPassou = s.passou(e.prazo_sugestoes) || sorteada;
  const responsavel = p.responsavel_id ? db.prepare('SELECT nome FROM pessoas WHERE id = ?').get(p.responsavel_id) : null;
  const dependentes = s.q.dependentesNaEdicao.all(e.id, p.pessoa_id);
  const sugestoes = s.q.sugestoes.all(p.id);
  const primeiroNome = p.nome.split(' ')[0];
  const quemComeca = e.quem_comeca_id ? s.q.participacao.get(e.quem_comeca_id) : null;
  const participouDoSorteio = sorteada && db.prepare('SELECT 1 FROM pares WHERE participacao_id = ?').get(p.id);
  const faixa = (() => {
    const mn = e.valor_min, mx = e.valor_max;
    if (mn == null && mx == null) return 'a definir';
    if (mn == null || mx == null || mn === mx) return s.reais(mx ?? mn);
    return `${s.reais(mn)} a ${s.reais(mx)}`;
  })();

  const conectado = sessoes.ler(req);
  if (p.pin_hash && !conectado) return res.send(pagina({titulo: e.nome, experiencia:'convite', corpo:`${aviso(req)}<section class="cartao"><h2>Olá, ${h(primeiroNome)}!</h2><p>Entre uma vez para cuidar do seu perfil, conversar e abrir sua raspadinha.</p><form class="acesso-participante" method="post" action="/c/${h(p.token)}/entrar"><label>Seu PIN</label><input type="password" name="pin" pattern="[0-9]{4,6}" inputmode="numeric" maxlength="6" required autocomplete="current-password"><div class="acesso-acoes"><button class="btn">Entrar</button><a class="btn sec" href="/c/${h(p.token)}/esqueci-pin">Esqueci meu PIN</a></div></form></section>`}));
  let corpo = aviso(req);
  if(conectado) corpo += `<section class="cartao"><p>Você está conectado como <b>${h(p.nome)}</b>. Seu acesso dura até 24 horas.</p><form method="post" action="/c/${h(p.token)}/sair">${campoAcesso(req,'sair')}<button class="btn sec mini">Sair deste perfil</button></form></section>`;
  if(e.encerrada_em) corpo += `<section class="cartao"><h2>Essa roda virou lembrança!</h2><a class="btn" href="/c/${h(p.token)}/album">Ver álbum da edição</a></section>`;



  corpo += `
  <section class="cartao convite-hero">
    <div class="convite-apresentacao"><span class="etiqueta">${sorteada ? 'A surpresa está pronta' : 'Seu lugar na nossa roda'}</span><h2>${sorteada ? 'Tem uma surpresa<br>esperando por você.' : 'O melhor presente<br>é reunir a família.'}</h2>
    <p class="ola">${responsavel
      ? `Este é o cadastro de <b>${h(p.nome)}</b>, sob responsabilidade de ${h(responsavel.nome)}.`
      : `Olá, <b>${h(primeiroNome)}</b>! Este é o seu link pessoal. Não o compartilhe.`}</p>
    ${e.mensagem ? `<p>${h(e.mensagem)}</p>` : ''}
    ${sorteada && participouDoSorteio ? '<a class="btn convite-principal" href="#raspadinha">Abrir minha raspadinha <span aria-hidden="true">↗</span></a>' : ''}</div><img class="presente-ilustracao" src="/presente.svg" alt="" width="320" height="320"><div class="fatos">
      <div class="fato"><b>Sorteio</b><span>${h(s.formatar(e.sorteio_em))}</span></div>
      <div class="fato"><b>Entrega</b><span>${h(s.formatar(e.entrega_em))}</span></div>
      <div class="fato"><b>Valor do presente</b><span>${h(faixa)}</span></div>
      ${e.entrega_local ? `<div class="fato"><b>Local</b><span>${h(e.entrega_local)}</span></div>` : ''}
    </div>
  </section>`;

  const cartaoSocial = p.pin_hash && p.status === 'confirmado' ? `<section class="cartao convite-social"><div><span class="etiqueta">A festa começa antes</span><h2>A família está por aqui.</h2><p>Converse, tire dúvidas e conte quando comprar seu presente.</p></div><a class="btn" href="/c/${h(p.token)}/interacoes">Entrar nas conversas e compras <span aria-hidden="true">↗</span></a></section>` : '';
  if (!sorteada) corpo += cartaoSocial;

  /* ---------- Depois do sorteio: raspadinha ---------- */
  if (sorteada) {
    if (participouDoSorteio && p.pin_hash) {
      corpo += `
      <section class="cartao" id="raspadinha" data-token="${h(p.token)}" data-csrf="${h(conectado?.csrf || '')}">
        <h2>🎁 O sorteio foi realizado!</h2>
        <p>Seu acesso já está confirmado. Abra e raspe a tela para descobrir seu amigo oculto.</p>
        <form id="form-pin" class="acoes" autocomplete="off">

          <button class="btn" type="submit">Abrir raspadinha</button>
        </form>
        <div id="pin-erro" class="aviso erro" hidden></div>
        <div id="raspa-area" hidden>
          <div class="raspa-wrap">
            <div class="raspa-premio" id="raspa-premio"></div>
            <canvas class="raspa-canvas" id="raspa-canvas" aria-label="Raspe para revelar"></canvas>
          </div>
        </div>
      </section>`;
    } else if (participouDoSorteio && !p.pin_hash) {
      corpo += `<section class="cartao"><h2>PIN indisponível</h2><p>Fale com o organizador para conferir seu acesso.</p></section>`;
    } else {
      corpo += `<section class="cartao"><h2>O sorteio foi realizado</h2>
        <p>${p.status === 'recusado' ? 'A participação foi recusada nesta edição.' : 'A confirmação não chegou dentro do prazo, por isso este cadastro ficou fora do sorteio.'} Fale com o organizador se houver algum engano.</p></section>`;
    }
    if (quemComeca) {
      corpo += `<section class="cartao"><h3>🎄 Quem abre a brincadeira</h3>
        <p><b>${h(quemComeca.nome)}</b> começa a entrega no dia da confraternização. Quem receber o presente é o próximo a revelar quem tirou, até a roda se fechar.</p></section>`;
    }
  }

  if (sorteada) corpo += cartaoSocial;

  const perfilHTML = `
    <section class="cartao painel-etapa" id="etapa-perfil" data-etapa="perfil" aria-labelledby="aba-perfil">
      <span class="etiqueta">Pra reconhecer você</span><h2>Deixe seu perfil com a sua cara.</h2>
      <div class="foto-linha">
        ${avatar(p.foto, p.nome)}
        <div>
          <p class="muted pequeno" style="margin:0 0 8px">A foto aparece para quem tirar ${responsavel ? h(primeiroNome) : 'você'} na raspadinha.</p>
          <label class="btn sec mini" style="margin:0">Escolher foto<input type="file" accept="image/*" id="foto-input" data-token="${h(p.token)}" hidden></label>
          <div id="foto-acesso">${campoAcesso(req, 'foto')}</div><div id="foto-status" class="muted pequeno"></div>
        </div>
      </div>
      <form method="post" action="/c/${h(p.token)}/dados">
          ${campoAcesso(req, 'dados')}
        <label for="nome">Nome</label>
        <input type="text" id="nome" name="nome" value="${h(p.nome)}" required maxlength="80">
        ${responsavel ? '' : `
        <div class="grade-2">
          <div><label for="telefone">WhatsApp</label><input type="tel" id="telefone" name="telefone" value="${h(p.telefone)}" placeholder="(21) 99999-9999"></div>
          <div><label for="email">E-mail</label><input type="email" id="email" name="email" value="${h(p.email)}"></div>
        </div>`}
        <div class="acoes"><button class="btn sec">Salvar dados</button></div>
      </form>
    </section>`;

  if(sorteada) corpo += perfilHTML.replace('cartao painel-etapa','cartao').replace('data-etapa="perfil" aria-labelledby="aba-perfil"','');

  /* ---------- Antes do sorteio: confirmação, dados, sugestões ---------- */
  if (!sorteada) {
    corpo += `<nav class="etapas" data-abas data-inicial="${p.status === 'confirmado' ? (p.foto ? 'presentes' : 'perfil') : 'participacao'}">
      <button id="aba-participacao" class="etapa" data-etapa-alvo="participacao" aria-controls="etapa-participacao"><span class="etapa-num">1</span> Confirmar</button>
      <button id="aba-perfil" class="etapa" data-etapa-alvo="perfil" aria-controls="etapa-perfil"><span class="etapa-num">2</span> Seu perfil</button>
      <button id="aba-presentes" class="etapa" data-etapa-alvo="presentes" aria-controls="etapa-presentes"><span class="etapa-num">3</span> Presentes</button>
    </nav>`;
    corpo += `
    <section class="cartao painel-etapa" id="etapa-participacao" data-etapa="participacao" aria-labelledby="aba-participacao">
      <span class="etiqueta">Primeiro, seu lugar na roda</span><h2>Vamos celebrar juntos?</h2>
      ${prazoConfPassou
        ? `<p>Prazo de confirmação encerrado. Situação: <span class="pill ${h(p.status)}">${h(p.status)}</span></p>`
        : `<form method="post" action="/c/${h(p.token)}/confirmar">
          ${campoAcesso(req, 'confirmar')}
            <p class="muted">Prazo para responder: ${h(s.formatar(e.prazo_confirmacao))}</p>
            <div class="escolha">
              <label><input type="radio" name="resposta" value="confirmado" ${p.status === 'confirmado' ? 'checked' : ''} required><span class="op sim">Vou participar</span></label>
              <label><input type="radio" name="resposta" value="recusado" ${p.status === 'recusado' ? 'checked' : ''}><span class="op nao">Não vou</span></label>
            </div>
            ${p.pin_hash
              ? `<p class="muted pequeno">PIN já criado. Enquanto estiver conectado, não será pedido novamente.</p>`
              : `<p class="muted pequeno" style="margin-top:14px">Crie um PIN de 4 a 6 números. Ele protege seu acesso e o resultado de ${responsavel ? 'vocês' : 'você'} (nem o organizador o conhece).</p>${camposPin(false)}`}
            <div class="acoes"><button class="btn">Enviar resposta</button></div>
          </form>`}
    </section>`;

    corpo += perfilHTML;

    corpo += `
    <section class="cartao painel-etapa" id="etapa-presentes" data-etapa="presentes" aria-labelledby="aba-presentes">
      <span class="etiqueta">Uma ajudinha para quem te tirou</span><h2>O que faria você sorrir?</h2>
      <p class="muted">Até três ideias. Quanto mais detalhe, mais fácil acertar! Só o que é o presente é obrigatório. Prazo: ${h(s.formatar(e.prazo_sugestoes))}.</p>
      <form method="post" action="/c/${h(p.token)}/sugestoes">
          ${campoAcesso(req, 'sugestoes')}
        ${[0, 1, 2].map((i) => {
          const sg = sugestoes[i] || {};
          const dis = prazoSugPassou ? 'disabled' : '';
          return `
        <fieldset class="sugestao">
          <legend class="num">Sugestão ${i + 1}</legend>
          <label for="texto${i}">O que é</label>
          <input type="text" id="texto${i}" name="texto${i}" value="${h(sg.texto)}" maxlength="140" placeholder="Ex.: perfume, livro, camisa social" ${dis}>
          <div class="grade-2">
            <div><label for="cor${i}">Cor</label><input type="text" id="cor${i}" name="cor${i}" value="${h(sg.cor)}" maxlength="60" placeholder="Ex.: azul-marinho" ${dis}></div>
            <div><label for="tamanho${i}">Tamanho ou numeração</label><input type="text" id="tamanho${i}" name="tamanho${i}" value="${h(sg.tamanho)}" maxlength="60" placeholder="Ex.: M, 42, 100 ml" ${dis}></div>
          </div>
          <label for="detalhes${i}">Marca, modelo e outros detalhes</label>
          <input type="text" id="detalhes${i}" name="detalhes${i}" value="${h(sg.detalhes)}" maxlength="200" placeholder="Ex.: marca X, sem perfume, voltagem 220 V" ${dis}>
          <label for="link${i}">Link do produto</label>
          <input type="text" inputmode="url" autocapitalize="off" spellcheck="false" id="link${i}" name="link${i}" value="${h(sg.link)}" maxlength="500" placeholder="Cole o link aqui" ${dis}>
          <label for="onde${i}">Ou onde encontrar</label>
          <input type="text" id="onde${i}" name="onde${i}" value="${h(sg.onde)}" maxlength="160" placeholder="Ex.: loja tal no Shopping Tijuca, qualquer farmácia" ${dis}>
        </fieldset>`;
        }).join('')}
        ${prazoSugPassou ? '<p class="aviso info">Prazo de sugestões encerrado.</p>' : '<div class="acoes"><button class="btn sec">Salvar sugestões</button></div>'}
      </form>
    </section>`;

    corpo += `
    <section class="cartao">
      <details>
        <summary>Indicar outro familiar para participar</summary>
        <form method="post" action="/c/${h(p.token)}/indicar">
          ${campoAcesso(req, 'indicar')}
          <label for="ind-nome">Nome</label><input type="text" id="ind-nome" name="nome" required maxlength="80">
          <label for="ind-tel">WhatsApp (ou do responsável, se for criança)</label><input type="tel" id="ind-tel" name="telefone" maxlength="30">
          <label for="ind-obs">Observação</label><input type="text" id="ind-obs" name="observacao" maxlength="200" placeholder="Ex.: filha da Ana, 6 anos">
          <div class="acoes"><button class="btn sec">Enviar indicação</button></div>
        </form>
        <p class="muted pequeno">O organizador recebe a indicação e envia o convite.</p>
      </details>
    </section>`;
  }

  if (dependentes.length) {
    corpo += `
    <section class="cartao dependentes">
      <h3>Sob sua responsabilidade</h3>
      <p class="muted pequeno">Cada um tem link próprio. Use-os para confirmar, enviar foto e sugestões${sorteada ? ' e abrir a raspadinha' : ''}.</p>
      ${dependentes.map((d) => `<a href="/c/${h(d.token)}">${avatar(d.foto, d.nome, 'ini')}<span><b>${h(d.nome)}</b><br><span class="muted pequeno">${h(d.status)}</span></span></a>`).join('')}
    </section>`;
  }

  if (p.pin_hash) {
    const c=email.contato(p);
    corpo += `<section class="cartao"><h2>Seu e-mail, seu acesso</h2><p>${c?.email_verificado===c?.email && c?.email ? 'E-mail verificado. Você poderá recuperar o PIN por ele.' : 'Verifique seu e-mail para recuperar o PIN sem guardar códigos.'}</p>${!email.configurado()?'<p class="aviso info">O organizador ainda precisa configurar o envio de e-mails.</p>':''}<form method="post" action="/c/${h(p.token)}/verificar-email">${campoAcesso(req,'email')}<button class="btn sec" ${email.configurado()?'':'disabled'}>Enviar link de verificação</button></form><p class="muted pequeno">Ao verificar, você aceita receber confirmações, avisos do sorteio e lembretes. Para crianças, usamos o e-mail do responsável.</p></section>`;
  }
  res.send(pagina({
    titulo: e.nome, selo: e.grupo_nome, corpo, experiencia: 'convite',
    scripts: sorteada ? ['/raspadinha.js','/convite.js'] : ['/convite.js'],
  }));
});

function camposPin(obrigatorio = true, prefixo = '') {
  return `<div class="grade-2">
    <div><label for="${prefixo}pin">PIN</label><input type="password" id="${prefixo}pin" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" ${obrigatorio ? 'required' : ''} autocomplete="new-password"></div>
    <div><label for="${prefixo}pin2">Repita o PIN</label><input type="password" id="${prefixo}pin2" name="pin2" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" ${obrigatorio ? 'required' : ''} autocomplete="new-password"></div>
  </div>`;
}

function validarPin(pin, pin2) {
  if (!/^\d{4,6}$/.test(pin || '')) return 'O PIN deve ter de 4 a 6 números.';
  if (pin !== pin2) return 'Os dois PINs digitados não conferem.';
  return null;
}

r.post('/c/:token/entrar',carregar,(req,res)=>{
 const erro=recuperacao.validar(req.part,req.body.pin,'pin');
 if(erro) return voltar(res,req.part.token,erro,true);
 sessoes.criar(res,req.part); voltar(res,req.part.token,'Você está conectado!');
});
r.post('/c/:token/sair',carregar,(req,res)=>{
 const sessao=sessoes.ler(req);
 if(!sessao || req.body.csrf!==sessao.csrf) return res.status(403).send('Atualize a página.');
 sessoes.sair(res,req.part,sessao); voltar(res,req.part.token,'Você saiu deste perfil.');
});
r.get('/c/:token/esqueci-pin',carregar,(req,res)=>res.send(pagina({titulo:'Recuperar PIN',corpo:`${aviso(req)}<section class="cartao"><h2>Esqueceu seu PIN?</h2><p>Enviamos um link de 30 minutos ao e-mail verificado do seu perfil ou responsável.</p>${!email.configurado()?'<p class="aviso info">O envio de e-mails ainda não foi configurado. Fale com o organizador.</p>':''}<form method="post" action="/c/${h(req.part.token)}/esqueci-pin"><button class="btn" ${email.configurado()?'':'disabled'}>Enviar link de recuperação</button></form><a class="btn sec" href="/c/${h(req.part.token)}">Voltar</a></section>`})));
r.post('/c/:token/esqueci-pin',carregar,(req,res)=>{
 try { email.criarLink(req.part,'recuperar'); void email.processar(); voltar(res,req.part.token,'Link de recuperação solicitado. Confira seu e-mail e a pasta de spam.'); }
 catch(err) { voltar(res,req.part.token,err.message,true); }
});
r.post('/c/:token/verificar-email',carregar,protegerAlteracao,(req,res)=>{
 try { email.criarLink(req.part,'verificar'); void email.processar(); voltar(res,req.part.token,'Link de verificação solicitado. Confira seu e-mail.'); }
 catch(err) { voltar(res,req.part.token,err.message,true); }
});
r.get('/c/:token/email/:chave',carregar,(req,res)=>{
 const l=email.lerLink(req.part,req.params.chave);
 if(!l) return res.status(400).send(pagina({titulo:'Link expirado',corpo:'<section class="cartao"><p>Este link expirou ou já foi usado. Solicite outro no aplicativo.</p></section>'}));
 res.send(pagina({titulo:l.tipo==='recuperar'?'Criar outro PIN':'Verificar e-mail',corpo:`${aviso(req)}<section class="cartao"><p>${l.tipo==='recuperar'?'Escolha seu novo PIN.':'Confirme que este é seu e-mail.'}</p><form method="post" action="/c/${h(req.part.token)}/email/${h(req.params.chave)}">${l.tipo==='recuperar'?camposPin():''}<button class="btn">${l.tipo==='recuperar'?'Salvar novo PIN':'Confirmar meu e-mail'}</button></form></section>`}));
});
r.post('/c/:token/email/:chave',carregar,(req,res)=>{
 const p=req.part,l=email.lerLink(p,req.params.chave);
 if(!l) return res.status(400).send('Link expirado ou já usado. Solicite outro.');
 if(l.tipo==='recuperar') { const erro=validarPin(req.body.pin,req.body.pin2); if(erro) return res.redirect(303,req.path+'?erro='+encodeURIComponent(erro)); }
 db.transaction(()=>{
  db.prepare('UPDATE links_email SET usado_em=? WHERE hash=?').run(s.agoraISO(),l.hash);
  if(l.tipo==='verificar') db.prepare('UPDATE pessoas SET email_verificado=? WHERE id=?').run(l.destino,email.contato(p).id);
  else {
   db.prepare('UPDATE participacoes SET pin_hash=?,pin_recuperacao_hash=NULL,pin_tentativas=0,pin_bloqueio_ate=NULL,pin_redefinido_em=? WHERE id=?').run(seg.hashPin(req.body.pin),s.agoraISO(),p.id);
   db.prepare('DELETE FROM sessoes_pessoas WHERE participacao_id=?').run(p.id);
  }
 })();
 if(l.tipo==='recuperar') sessoes.criar(res,s.q.participacao.get(p.id));
 else if(p.status==='confirmado') email.aviso(p,req.edicao,'confirmacao');
 void email.processar();
 voltar(res,p.token,l.tipo==='recuperar'?'PIN atualizado. Você está conectado!':'E-mail verificado!');
});

/* ------------------------------------------------------------------ */
r.post('/c/:token/confirmar', carregar, protegerAlteracao, (req, res) => {
  const { part: p, edicao: e } = req;
  if (e.status === 'sorteada' || s.passou(e.prazo_confirmacao)) return voltar(res, p.token, 'O prazo de confirmação já terminou.', true);
  const resposta = req.body.resposta === 'confirmado' ? 'confirmado' : req.body.resposta === 'recusado' ? 'recusado' : null;
  if (!resposta) return voltar(res, p.token, 'Escolha uma opção.', true);
  let pinHash = p.pin_hash;

  if (resposta === 'confirmado' && !pinHash) {
    const erro = validarPin(req.body.pin, req.body.pin2);
    if (erro) return voltar(res, p.token, erro, true);
    pinHash = seg.hashPin(req.body.pin);

  }
  db.prepare('UPDATE participacoes SET status = ?, pin_hash = ?, respondido_em = ? WHERE id = ?')
    .run(resposta, pinHash, s.agoraISO(), p.id);
  if (resposta === 'confirmado') { const atualizado=s.q.participacao.get(p.id); sessoes.criar(res, atualizado); email.aviso(atualizado,e,'confirmacao'); void email.processar(); }
  log(e.id, `${p.nome}: ${resposta === 'confirmado' ? 'confirmou' : 'recusou'} a participação.`);

  voltar(res, p.token, resposta === 'confirmado' ? 'Participação confirmada! Agora capriche na foto e nas sugestões.' : 'Resposta registrada. Sentiremos sua falta!');
});

r.post('/c/:token/pin', carregar, (req, res) => {
  const p = req.part;
  if (req.edicao.status === 'sorteada') return voltar(res, p.token, 'Depois do sorteio, recupere o PIN pelo e-mail verificado.', true);
  if (p.pin_hash) return voltar(res, p.token, 'O PIN já está definido.', true);
  const erro = validarPin(req.body.pin, req.body.pin2);
  if (erro) return voltar(res, p.token, erro, true);
  db.prepare('UPDATE participacoes SET pin_hash = ?, pin_tentativas = 0, pin_bloqueio_ate = NULL WHERE id = ?').run(seg.hashPin(req.body.pin), p.id);
  log(p.edicao_id, `${p.nome}: criou novo PIN.`);
  sessoes.criar(res,s.q.participacao.get(p.id));
  voltar(res,p.token,'PIN salvo. Você está conectado!');
});

r.post('/c/:token/dados', carregar, protegerAlteracao, (req, res) => {
  const p = req.part;
  const nome = limpar(req.body.nome, 80);
  if (!nome) return voltar(res, p.token, 'Informe o nome.', true);
  if (p.responsavel_id) {
    db.prepare('UPDATE pessoas SET nome = ? WHERE id = ?').run(nome, p.pessoa_id);
  } else {
    const email = limpar(req.body.email, 120) || null;
    if(email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return voltar(res,p.token,'Informe um e-mail válido.',true);
    db.prepare('UPDATE pessoas SET nome = ?, telefone = ?, email = ? WHERE id = ?')
      .run(nome, limpar(req.body.telefone, 30) || null, email, p.pessoa_id);
  }
  voltar(res, p.token, 'Dados salvos.');
});

r.post('/c/:token/sugestoes', carregar, protegerAlteracao, (req, res) => {
  const { part: p, edicao: e } = req;
  if (e.status === 'sorteada' || s.passou(e.prazo_sugestoes)) return voltar(res, p.token, 'O prazo para sugestões terminou.', true);
  const b = req.body;
  const opc = (v, max) => limpar(v, max) || null;
  const linkInformado = [0, 1, 2].some((i) => limpar(b[`link${i}`]) && !urlValida(b[`link${i}`]));
  const itens = [0, 1, 2]
    .map((i) => ({
      texto: limpar(b[`texto${i}`], 140),
      link: urlValida(b[`link${i}`]),
      onde: opc(b[`onde${i}`], 160),
      cor: opc(b[`cor${i}`], 60),
      tamanho: opc(b[`tamanho${i}`], 60),
      detalhes: opc(b[`detalhes${i}`], 200),
    }))
    .filter((x) => x.texto);
  db.transaction(() => {
    db.prepare('DELETE FROM sugestoes WHERE participacao_id = ?').run(p.id);
    const ins = db.prepare(`INSERT INTO sugestoes (participacao_id, ordem, texto, link, onde, cor, tamanho, detalhes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    itens.forEach((x, i) => ins.run(p.id, i + 1, x.texto, x.link, x.onde, x.cor, x.tamanho, x.detalhes));
  })();
  if (linkInformado) return voltar(res, p.token, 'Sugestões salvas, mas um dos links não parecia válido e foi descartado. Confira.', true);
  voltar(res, p.token, itens.length ? 'Sugestões salvas.' : 'Sugestões apagadas.');
});

r.post('/c/:token/indicar', carregar, protegerAlteracao, (req, res) => {
  const { part: p, edicao: e } = req;
  const nome = limpar(req.body.nome, 80);
  if (!nome) return voltar(res, p.token, 'Informe o nome de quem você quer indicar.', true);
  db.prepare('INSERT INTO indicacoes (edicao_id, indicado_por, nome, telefone, observacao) VALUES (?, ?, ?, ?, ?)')
    .run(e.id, p.id, nome, limpar(req.body.telefone, 30) || null, limpar(req.body.observacao, 200) || null);
  log(e.id, `${p.nome} indicou ${nome}.`);
  voltar(res, p.token, `Indicação de ${nome} enviada ao organizador.`);
});

r.post('/c/:token/foto', carregar, protegerAlteracao, upload.single('foto'), (req, res) => {
  try {
    const nome = salvarFoto(req.part.pessoa_id, req.file);
    res.json({ ok: true, foto: `/fotos/${nome}` });
  } catch (err) {
    res.status(400).json({ ok: false, erro: err.message });
  }
});

r.post('/c/:token/revelar', carregar, (req, res) => {
  const sessao=sessoes.ler(req);
  if(sessao && req.body.csrf!==sessao.csrf) return res.status(403).json({erro:'Atualize a página.'});
  const resultado = s.revelar(req.part, req.body.pin, !!sessao);
  if(!resultado.erro && !sessao) sessoes.criar(res,req.part);
  if (resultado.erro) return res.status(400).json(resultado);
  res.json(resultado);
});


function exigirSessao(req,res,next) {
 req.sessao=sessoes.ler(req);
 if(!req.sessao) return res.redirect(303,`/c/${req.part.token}`);
 if(req.method==='POST'&&req.body.csrf!==req.sessao.csrf) return res.status(403).send('Atualize a página.');
 next();
}
r.get('/c/:token/album',carregar,exigirSessao,(req,res)=>{
 const album=require('./album');const e=req.edicao;
 if(!e.encerrada_em) return res.status(403).send('O álbum estará disponível após o encerramento.');
 const recado=db.prepare('SELECT texto FROM album_recados WHERE participacao_id=?').get(req.part.id)?.texto||'';
 res.send(pagina({titulo:'Álbum da nossa roda',experiencia:'convite',corpo:`${aviso(req)}<a class="btn sec" href="/c/${h(req.part.token)}">Voltar ao meu perfil</a><section class="cartao"><a class="btn" href="/c/${h(req.part.token)}/album.pdf">Baixar álbum em PDF</a><h2>Seu recado para o álbum</h2><p>Escreva apenas o que deseja compartilhar com toda a família no PDF. Deixe vazio para retirar seu recado.</p><form method="post" action="/c/${h(req.part.token)}/album/recado">${campoAcesso(req,'recado')}<textarea name="texto" maxlength="500">${h(recado)}</textarea><button class="btn sec">Salvar recado para a família</button></form></section>${album.previa(album.dados(e))}`}));
});
r.post('/c/:token/album/recado',carregar,exigirSessao,(req,res)=>{
 if(!req.edicao.encerrada_em) return res.status(403).send('Aguarde o encerramento.');
 const texto=limpar(req.body.texto,500);
 if(texto) db.prepare('INSERT INTO album_recados (participacao_id,texto) VALUES (?,?) ON CONFLICT(participacao_id) DO UPDATE SET texto=excluded.texto').run(req.part.id,texto);
 else db.prepare('DELETE FROM album_recados WHERE participacao_id=?').run(req.part.id);
 res.redirect(303,`/c/${req.part.token}/album?ok=Recado%20salvo`);
});
r.get('/c/:token/album.pdf',carregar,exigirSessao,(req,res)=>{
 if(!req.edicao.encerrada_em) return res.status(403).send('Aguarde o encerramento.');
 const album=require('./album');res.type('pdf').attachment(`album-amigo-oculto-${req.edicao.ano}.pdf`);album.pdf(album.dados(req.edicao),res);
});

module.exports = r;
