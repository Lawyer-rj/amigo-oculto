#!/usr/bin/env bash
# Sobe o app em modo de produção num banco temporário e roda todas as verificações.
set -u
cd "$(dirname "$0")/.."
D=$(mktemp -d)
PORTA=3999

echo "1) Produção sem APP_SECRET deve recusar subir:"
NODE_ENV=production DATA_DIR=$D timeout 5 node src/server.js 2>&1 | grep -o "APP_SECRET ausente[^.]*" | head -1

export NODE_ENV=production DATA_DIR=$D PORT=$PORTA ADMIN_SENHA=senha-prod BASE_URL=http://localhost:$PORTA
export APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
node scripts/carga-inicial.js
node src/server.js > "$D/servidor.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$D"' EXIT
sleep 1.5

echo "2) Teste ponta a ponta:"
BASE=http://localhost:$PORTA node test/e2e.js

echo "3) Pares no banco (devem estar cifrados):"
node -e "const db=require('better-sqlite3')('$D/amigo-oculto.db');for(const r of db.prepare('select participacao_id, destino_cifrado from pares limit 2').all())console.log(' ', r.participacao_id, '->', r.destino_cifrado.slice(0,40)+'...')"

echo "4) Senha errada no painel:"
curl -s -o /dev/null -w '  HTTP %{http_code} -> %{redirect_url}\n' -X POST -d senha=errada localhost:$PORTA/admin/entrar

echo "5) Cookie do painel em produção:"
curl -s -D - -o /dev/null -X POST -d senha=senha-prod localhost:$PORTA/admin/entrar | grep -i '^set-cookie' | sed 's/=[^;]*;/=***;/'

echo "6) Testes do algoritmo:"
node --test test/*.test.js 2>&1 | grep -E "^# (pass|fail)"
