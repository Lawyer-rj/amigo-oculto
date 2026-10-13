# Amigo Oculto da Família

Aplicativo próprio para o amigo oculto anual da família: convites individuais por WhatsApp, confirmação com PIN, foto e até três sugestões de presente, sorteio automático em **ciclo único** (com a regra de não repetir o ano anterior), raspadinha digital e sorteio de quem começa a entrega.

## Como rodar no computador (Docker Desktop)

1. Abra o **Terminal** (PowerShell) dentro desta pasta.
2. Crie o arquivo de configuração a partir do modelo:
   ```powershell
   Copy-Item .env.example .env
   ```
3. Gere a chave secreta e cole no `.env`, na linha `APP_SECRET=`:
   ```powershell
   docker run --rm node:22-bookworm-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Defina também `ADMIN_SENHA` (a senha do painel).
4. Suba o aplicativo:
   ```powershell
   docker compose up -d --build
   ```
5. Na primeira vez, carregue os participantes e a edição 2026. Os nomes ficam em `scripts/participantes.json`, que **não vai para o Git** (privacidade); use `scripts/participantes.exemplo.json` como modelo. Depois:
   ```powershell
   docker compose up -d --build
   docker compose exec amigo-oculto node scripts/carga-inicial.js
   ```
6. Abra **http://localhost:3000/admin** e entre com a senha.

Comandos úteis:

| O que fazer | Comando |
|---|---|
| Parar | `docker compose stop` |
| Ligar de novo | `docker compose start` |
| Ver o registro do servidor | `docker compose logs -f` |
| Atualizar depois de mudar o código | `docker compose up -d --build` |
| Cópia de segurança do banco | `docker compose exec amigo-oculto node -e "require('better-sqlite3')('/data/amigo-oculto.db').backup('/data/backup.db')"` e depois `docker compose cp amigo-oculto:/data/backup.db .\backup.db` |

Os dados (banco e fotos) ficam no volume Docker `amigo-oculto-dados`. Apagar o contêiner **não** apaga os dados; apagar o volume, sim.

## Como funciona

**Organizador (painel `/admin`)**
- Cadastra pessoas, grupos e núcleos familiares; crianças ficam vinculadas a um responsável.
- Define prazos, valores mínimo e máximo, data e hora do sorteio, local e mensagem.
- Envia o convite de cada pessoa pelo botão **Convite** (abre o WhatsApp com a mensagem pronta e o link pessoal). Para crianças, a mensagem vai ao telefone do responsável.
- Acompanha confirmações, fotos, sugestões e indicações de novos familiares.
- Pode **simular** o sorteio (só estatística, nada é gravado) e, depois do sorteio, **sortear quem começa** a entrega.
- **Nunca vê os pares.** Eles ficam cifrados no banco.

**Participante (link pessoal `/c/...`)**
- Confirma ou recusa e cria um **PIN** de 4 a 6 números.
- Envia foto, corrige os dados e cadastra até três sugestões com link de loja.
- Indica outros familiares.
- Depois do sorteio, digita o PIN e **raspa a tela** para ver nome, foto e sugestões do amigo oculto.

**Sorteio**
- Roda sozinho na data marcada (verificação a cada minuto) ou pelo botão "Sortear agora".
- Entra quem confirmou e tem PIN; pendentes ficam de fora.
- Forma um único ciclo com todos (A → B → C → … → A): ninguém tira a si mesmo, não há pares recíprocos isolados e a entrega percorre todo mundo.
- Evita repetir os pares da edição anterior do mesmo grupo; se for matematicamente impossível (grupos muito pequenos), escolhe o ciclo com menos repetições e avisa.

## Segurança e sigilo

- Pares cifrados com AES-256-GCM; a chave deriva de `APP_SECRET`, que fica fora do banco. **Não troque `APP_SECRET` depois do sorteio**: os pares ficariam ilegíveis.
- O resultado só sai do servidor depois do PIN correto; 5 erros bloqueiam por 15 minutos. O organizador pode apagar um PIN esquecido (a pessoa cria outro), mas não consegue ler o resultado.
- Links pessoais aleatórios (128 bits), páginas fora de buscadores e sem envio do endereço para sites de lojas.
- Fotos verificadas pelo conteúdo do arquivo (JPG, PNG ou WEBP), reduzidas no próprio celular antes do envio.
- Limite de tentativas de senha no painel.

Ressalva honesta: quem tiver ao mesmo tempo o banco **e** o `APP_SECRET` consegue decifrar os pares. No computador ou na VPS, só você terá os dois.

## Para levar à VPS

O mesmo `docker compose` serve. Na VPS: defina `BASE_URL=https://seu-subdominio`, coloque um proxy com HTTPS na frente (Caddy ou Traefik) e copie o volume de dados, se quiser levar o que foi cadastrado aqui.

## Privacidade do repositório

Ficam fora do Git: `.env` (senha e chave), o banco e as fotos (volume Docker), `scripts/participantes.json` e os scripts de carga com telefones e e-mails.

## Testes

```powershell
docker compose exec amigo-oculto node --test test/
```
Fora do Docker, com Node 22: `npm test` (algoritmo) e `scripts/verificar-producao.sh` (ponta a ponta).

## Créditos

Código próprio. Ideias de projeto (token de revelação, agendador interno, histórico de pares) inspiradas no repositório [Rodaviva29/secret-santa](https://github.com/Rodaviva29/secret-santa), licença MIT.
