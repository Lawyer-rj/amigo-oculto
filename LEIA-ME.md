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
- **O painel não exibe os pares.** Eles ficam cifrados no banco.

**Participante (link pessoal `/c/...`)**
- Confirma ou recusa e cria um **PIN** de 4 a 6 números.
- Envia foto, corrige os dados e cadastra até três sugestões com link de loja.
- Indica outros familiares.
- Depois do sorteio, digita o PIN e **raspa a tela** para ver nome, foto e sugestões do amigo oculto.

**Sorteio**
- Roda sozinho na data marcada (verificação a cada minuto) ou pelo botão "Sortear agora".
- Entra quem confirmou e tem PIN; pendentes ficam de fora.
- Forma um único ciclo com todos (A → B → C → … → A): ninguém tira a si mesmo, não há pares recíprocos isolados e a entrega percorre todo mundo.
- Evita repetir os pares da edição anterior do mesmo grupo; se a busca não encontrar um ciclo sem repetições, usa o melhor candidato encontrado e avisa, sem afirmar que a repetição era inevitável.

## Segurança e sigilo

- Pares cifrados com AES-256-GCM; a chave deriva de `APP_SECRET`, que fica fora do banco. **Não troque `APP_SECRET` depois do sorteio**: os pares ficariam ilegíveis.
- O resultado só sai do servidor depois do PIN correto; 5 erros bloqueiam por 15 minutos. Antes do sorteio, o organizador pode apagar o PIN para a pessoa criar outro. Depois do sorteio, a recuperação exige o código pessoal que somente o participante recebe.
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
docker compose exec amigo-oculto node --test test/*.test.js
```
Fora do Docker, com Node 22: `npm test` (algoritmo, mensagens e fluxo gratuito, com dados temporários) e `scripts/verificar-producao.sh` (ponta a ponta).

## Créditos

Código próprio. Ideias de projeto (token de revelação, agendador interno, histórico de pares) inspiradas no repositório [Rodaviva29/secret-santa](https://github.com/Rodaviva29/secret-santa), licença MIT.

## Uso sem serviços pagos

O aplicativo não precisa de Twilio, Resend nem de uma conta de API da Meta para organizar a brincadeira. O envio por serviços fica bloqueado por padrão, mesmo se houver credenciais configuradas. O modo normal é:

1. Cadastre os contatos e escolha WhatsApp, e-mail ou SMS para cada destinatário. Para crianças, configure o contato do responsável.
2. No painel da edição, escolha o canal e clique em **Abrir mensagem**.
3. Confira o texto e confirme o envio no seu WhatsApp, aplicativo de e-mail ou aplicativo de SMS. No computador, SMS depende de aplicativo compatível; também é possível copiar a mensagem.
4. A pessoa abre o link, confirma ou recusa e cria seu PIN. Ao confirmar, recebe um código pessoal de recuperação e deve guardá-lo.
5. Preenche foto e até três sugestões, com loja ou local, link, cor, tamanho e detalhes.
6. O sorteio forma um ciclo único com os confirmados com PIN. Depois, use os mesmos canais para avisar que a raspadinha está disponível.

WhatsApp e e-mail usam os aplicativos e contas que você já tem; o aplicativo não cobra por esses envios. SMS pode consumir créditos ou a franquia da operadora. Para evitar esse custo, prefira WhatsApp ou e-mail. Nenhuma mensagem é enviada automaticamente nesta modalidade.

Abrir uma mensagem não confirma que ela foi enviada ou recebida. O painel identifica a abertura do WhatsApp e acompanha separadamente a confirmação de participação.

### Recuperação do PIN

O código de recuperação aparece apenas quando criado. O servidor armazena somente seu hash, e o painel do organizador não recebe o código. Se esquecer o PIN, a pessoa informa o código para criar outro; o código usado é substituído por um novo. Quem já tinha PIN pode gerar um código pelo link pessoal, informando o PIN atual. Tentativas incorretas são limitadas.

Depois do sorteio, o organizador não pode apagar PINs. Se a pessoa perder tanto o PIN quanto o código, a alternativa é avaliar a anulação e realização de um novo sorteio. Anular suspende o agendamento automático, permitindo ajustar os participantes antes de marcar outra data.

### Acesso pelos celulares

`localhost` funciona somente no computador que executa o aplicativo. Os convites precisam de um endereço acessível aos familiares, com HTTPS se o acesso for pela internet. Manter o app no seu computador exige que ele esteja ligado e acessível. A implementação dos canais não configura hospedagem, domínio ou acesso externo automaticamente.

### Integrações opcionais já preparadas

Os adaptadores de WhatsApp (Meta ou Twilio), SMS (Twilio) e e-mail (Resend) permanecem disponíveis para uso futuro. Só são habilitados se `ENVIO_POR_SERVICO=habilitado` for configurado explicitamente. Nenhuma conta foi contratada e o `.env` existente foi preservado. O modelo `.env.example` define `ENVIO_POR_SERVICO=desativado`.

Essas integrações não são necessárias para a brincadeira. Créditos da integração Meta: `THIRD-PARTY-NOTICES.md`.


## Conversas e compras

No seu link pessoal, clique em **Entrar nas conversas e compras** e digite seu PIN. O acesso permanece aberto por até quatro horas; use **Sair deste perfil** em aparelhos compartilhados. Para crianças, o responsável usa o link e PIN da criança. Cada perfil tem sua própria sessão.

### Compras

Depois do sorteio, clique em **Já comprei o presente!**. O grupo e o painel do organizador veem quem marcou a compra, sem indicação do presente ou do destinatário. É possível desmarcar. A informação é declarada pelo participante, sem comprovação de compra. Ao anular o sorteio, as marcações são limpas.

### Mural da família

Todos os confirmados na mesma edição podem escrever e ler. O nome do autor aparece. Há até 1.000 caracteres por mensagem e as últimas 100 mensagens ficam visíveis. Cada pessoa pode apagar suas próprias mensagens. Texto e links escritos são exibidos como texto, sem executar HTML.

### Conversas privadas

Escolha a pessoa em **Conversar com**. Só os dois participantes conseguem acessar pela aplicação. Essas conversas mostram os nomes e ficam separadas do mural. Não é possível conversar com participantes de outra edição.

### Conversa anônima do sorteio

Depois do sorteio, aparecem duas conversas:

- **Amigo que tirei — você fica anônimo:** pergunte sobre cor, tamanho e preferências. Seu nome não aparece para quem recebe a mensagem.
- **Quem me tirou — identidade oculta:** responda às perguntas de quem dará seu presente. A pessoa aparece como **Seu amigo oculto**.

Não assine mensagens anônimas nem forneça pistas que revelem quem você é. O aplicativo esconde a identidade, mas não pode impedir que alguém a conte no próprio texto. As conversas anônimas de um sorteio anulado ficam inacessíveis, e um novo sorteio cria novas conversas. O mural e as conversas privadas comuns permanecem na edição.

### Atualização e acesso

As mensagens, novas conversas e compras são consultadas a cada 10 segundos enquanto a página estiver aberta. Não são enviados avisos externos, SMS, e-mails ou mensagens de WhatsApp. Se a sessão expirar, entre novamente. Se o sorteio ocorrer enquanto você estiver numa página aberta antes dele, recarregue para ver os controles de compra.

Mudar ou recuperar o PIN invalida as sessões anteriores. Depois de criar o PIN, alterações no cadastro, foto, sugestões e confirmação também exigem o PIN ou uma sessão autenticada. Há bloqueio após cinco erros e limite de mensagens em sequência.

As mensagens e os vínculos das conversas ficam cifrados no banco com a chave do aplicativo. O painel do organizador não mostra conversas privadas. Quem administra o servidor e possui o banco e APP_SECRET ainda tem capacidade técnica de decifrar os dados; não há criptografia de ponta a ponta.

### Docker e migração

A atualização adiciona tabelas e colunas na inicialização e preserva os dados existentes. Antes de atualizar, faça backup do banco, fotos e configuração. Preserve APP_SECRET ao migrar para a VPS. Não é necessário contratar nenhum serviço de mensagens.


## Sessão, e-mail e álbum
O participante entra com PIN uma vez e mantém acesso ao perfil, sugestões, conversas e raspadinha por 24 horas. Sair, expirar ou trocar o PIN revoga o acesso. A criação inicial não mostra mais códigos longos.

Configure SMTP_HOST, SMTP_PORT (465 ou 587), SMTP_USER, SMTP_PASS e EMAIL_REMETENTE em ambiente privado. Use a senha de aplicativo quando exigida pelo provedor. TLS é obrigatório. Nunca inclua credenciais no Git. O envio fica indisponível até configuração; não há contratação automática.

Depois de cadastrar seu endereço, o participante clica em Enviar link de verificação. Links expiram em 30 minutos e são de uso único. Recuperação só usa o endereço já verificado, inclusive para crianças via responsável. Mudança de endereço exige nova verificação. O organizador pode enviar convite individual por SMTP quando configurado, e a fila mostra aceito pelo servidor ou incerto (sem reenvio automático que possa duplicar mensagens). Confirmações, resultado e lembretes a 24 horas do prazo são automáticos para contatos verificados. Os e-mails não revelam pares.

No final da troca, abra Edições > Álbum e lembranças > Preparar álbum. Inclua fotos JPG/PNG, uma mensagem para a capa e digite ENCERRAR. Isto publica os pares no histórico; não pode anular esse sorteio depois. Revise a prévia e baixe o PDF. Participantes conectados também podem baixar e incluir/remover seus próprios recados compartilháveis. Mensagens privadas, contatos, tokens e PINs ficam fora do PDF. Fotos WEBP de perfil aparecem na prévia; no PDF há o nome como alternativa, pois o gerador aceita JPG/PNG.

O backup ZIP é privado, acessível só ao organizador. Inclui TODAS as edições, SQLite consistente, fotos e APP_SECRET para restaurar conversas e pares cifrados. Não compartilhe no grupo. Configure novamente senha de organizador, endereço público e SMTP ao restaurar. O backup é criado sob demanda; não ocorre cópia automática para serviço externo.
