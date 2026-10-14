"use strict";
const crypto = require('crypto');
const {db} = require('./db');
const digest = v => crypto.createHash('sha256').update(v).digest('hex');
const nome = p => `ao_pessoa_${p.id}`;
const opcoes = p => `HttpOnly; SameSite=Strict; Path=/c/${p.token}; ${(process.env.BASE_URL || '').startsWith('https://') ? 'Secure; ' : ''}`;
function ler(req) {
 const p=req.part;
 const token=(req.headers.cookie||'').split(/;\s*/).find(x=>x.startsWith(nome(p)+'='))?.slice(nome(p).length+1);
 if(!token || token.length>100 || !p.pin_hash) return null;
 return db.prepare('SELECT * FROM sessoes_pessoas WHERE chave=? AND participacao_id=? AND pin_versao=? AND expira_em>?').get(digest(token),p.id,digest(p.pin_hash),new Date().toISOString()) || null;
}
function criar(res,p) {
 const token=crypto.randomBytes(32).toString('base64url');
 const csrf=crypto.randomBytes(24).toString('base64url');
 db.prepare('DELETE FROM sessoes_pessoas WHERE expira_em<=? OR participacao_id=?').run(new Date().toISOString(),p.id);
 db.prepare('INSERT INTO sessoes_pessoas (chave,participacao_id,pin_versao,csrf,expira_em) VALUES (?,?,?,?,?)').run(digest(token),p.id,digest(p.pin_hash),csrf,new Date(Date.now()+24*3600e3).toISOString());
 res.setHeader('Set-Cookie',`${nome(p)}=${token}; ${opcoes(p)}Max-Age=86400`);
 return csrf;
}
function sair(res,p,sessao) {
 if(sessao) db.prepare('DELETE FROM sessoes_pessoas WHERE chave=?').run(sessao.chave);
 res.setHeader('Set-Cookie',`${nome(p)}=; ${opcoes(p)}Max-Age=0`);
}
module.exports={ler,criar,sair};
