# WarmUp Studio (Aquecedor Redes Sociais)

Aquece contas do TikTok e do Instagram com Playwright, seguindo um plano de 5 fases (pronta no dia 22).
Uso pessoal do dono, nas contas dele. Interface e mensagens em português do Brasil.

## Rodar

```
npm install
cp .env.example .env   # SUPABASE_URL + chave SECRETA do Supabase
npm run app            # o aplicativo do Windows (Electron) a partir do projeto
npm run instalador     # gera release/WarmUp-Studio-Setup-<versão>.exe (confere que nenhum segredo vai junto)
npm run publicar       # gera e publica no CANAL DE TESTE (suba "version" e escreva em web/src/novidades.ts antes)
npm run liberar        # passa a versão em teste para TODOS os aparelhos (só quando o dono mandar)
npm start              # motor + painel no terminal; painel em http://localhost:3001
npm run ligar          # o mesmo em segundo plano pelo PM2 (desligar / status / logs / autostart:ligar)
npm run restaurar      # restaura data/profiles de um backup (motor desligado)
npm run simular -- alemdofato5 7   # simula 7 dias sem abrir navegador (só lê o Supabase)
npm run build          # gera o painel (web/dist); npm start e npm run ligar fazem isso sozinhos
npm run dev:web        # painel com recarga automática em http://localhost:5173 (precisa do motor ligado)
npm test               # testes (node:test, inclusive os .ts do painel)
npm run typecheck      # TypeScript do painel
npm run lint           # ESLint
npm run format         # Prettier
```

## Estrutura

- `motor/`: o robô. Playwright, agendador, banco. Escuta só em 127.0.0.1:3101.
  - `rules.js`: regras puras (dia, plano, teto de 120%, saúde, alertas, decisão do agendador). Toda lógica testável vai aqui.
  - `store.js`: estado em memória + gravação em lote no Supabase.
  - `runner.js`: sessões, navegador manual (login/captcha), vigia de sessão travada e prints de erro.
  - `scheduler.js`: piloto automático, teste dos proxies a cada 30 min e fim das férias.
  - `human.js`: comportamento humano (pausas de cauda longa, personalidade da conta, destino de cada vídeo, rolagem com inércia,
    digitação com erro e correção, curtida com dois cliques no vídeo).
    `bot.js` usa isso; `ctl.js` é o controle da sessão (o mesmo na sessão real e no simulador).
  - `cursor.js`: mouse do Playwright (curvas do ghost-cursor, clique em ponto variado). Não usar o `createCursor` do ghost-cursor:
    ele é do Puppeteer e quebra todo clique no Playwright.
  - Rotina do dia: `rules.planSlots` (horários e tamanho de cada sessão, perto do pico da conta). Sessão curta para em `ctl.target`.
    Sessão planejada que já chegou vale mais que o intervalo sorteado (`nextAfter`, até 3 h); só espera `SLOT_MIN_REST` (20 min).
    As sessões só caem nas horas em que o aparelho costuma ficar ligado (`motor/uptime.js` grava em `data/uptime.json` os
    minutos com internet por hora; na 1ª vez reconstrói pelo `logs/motor.log`, sem intervalos de 12 h+ = PC em espera;
    `rules.onHours` precisa de 2 dias). Rotina do dia com sessão futura fora dessas horas é replanejada uma vez (`slotsOf`).
  - `sim/`: simulador com relógio e página falsos (`npm run simular -- <conta|nova-tiktok> <dias>`). Roda o código real das plataformas.
  - `backup.js`: backup diário dos perfis (04:00, sem cache, 7 últimos). `proxycheck.js`: teste de proxy sem navegador (IP, país e fuso).
  - `platforms/`: TikTok e Instagram. Cada atividade declara as metas que conta (`produces`) e as que adianta (`advances`).
  - `api/`: rotas. `validate.js`: validação (zod) de tudo que entra.
- Aparelhos (app 2/5): cada PC/notebook é um aparelho do usuário e roda as PRÓPRIAS contas; vários ao mesmo tempo.
  - `motor/cloud.js`: entra no Supabase como o usuário (chave PÚBLICA, `supabase-config.js`; nunca a secreta), login do
    aparelho protegido pelo Windows (`dpapi.js`), registro em `devices`, sinal a cada minuto, comandos (`commands`).
  - `store.js` carrega todas as contas do usuário; roda e grava só as deste aparelho (`isMine`); as dos outros chegam
    pelo tempo real (somente leitura). `actions.js`: ação em conta de outro aparelho vira comando para ele.
    `publisher.js` publica o status (`accounts.status`). `boot.js` liga tudo depois do login. `summary.js`: resumo da conta.
  - `paths.js`: pasta de dados (`WU_DATA_DIR`; padrão `data/`).
  - Trava (`accounts.lease_device/lease_until`, `store.takeLease`): antes de abrir sessão ou navegador o aparelho pega a
    trava numa operação só no banco (conta dele e nenhum outro com trava válida; sem internet não abre). Vale 5 min,
    renovada a cada minuto pelo `publisher.js`, solta ao fechar; trava perdida (outro aparelho pegou) para a sessão aqui.
    "Rodar neste aparelho" espera a trava do outro vencer. Gravar uma conta que já existe é `update ... where device_id =
este aparelho` (nunca upsert): aparelho desatualizado não puxa de volta uma conta que foi para outro.
  - Logins das contas no Supabase (app 3/5): `vault.js` (chave aleatória do usuário, AES-256-GCM; trancada pela senha do
    app com scrypt em `user_keys` e copiada em cada aparelho com DPAPI em `data/vault-key.bin`). `logins.js` salva
    cookies + localStorage da plataforma (`storageState` do Playwright) em `account_logins` quando o login é detectado e
    no fim de cada sessão (só conta logada) e restaura sozinho ao abrir o navegador se a pasta do perfil não existe ou se a
    conta voltou de outro aparelho com login mais novo (`data/logins-sync.json`). A senha só passa pela memória.
  - `screens.js`: prints no Storage (bucket privado `screens`, `<dono>/<conta>/`); a rota do print busca lá se não está aqui.
- `painel/`: login pelo Supabase Auth (`authStore.js`: entrar, criar conta, esqueci a senha; sessões e acessos do painel
  em `data/painel/`), entrega o login ao motor (`/api/_device/link`), serve `web/dist` e repassa `/api` com a senha
  interna (`data/motor.token`) e o usuário (`x-wu-user`). Sem login, só a tela de login (`web/login.html`) abre.
  `/api/_device/link` e `/api/_device/vault` não passam do navegador: só o painel chama, depois de conferir a senha
  (`/auth/chave`: abrir a chave com a senha antiga ou começar uma nova).
- Banco: regras por dono (`auth.uid()`) em tudo; o 1º usuário fica com as contas antigas (`claim_legacy_accounts`).
- Metas personalizadas (`motor/custom.js`): modelos na configuração do usuário (`config.goalTemplates`, vale para todos os
  aparelhos; relidos a cada 2 min), conta escolhe com `goalTemplate` (sem = recomendada). Prazo de 5 a 90 dias:
  `phases.phasesFor(readyDay)` estica as 5 fases na mesma proporção. `planForDay(day, rng, template)`; trocar ou editar
  a meta refaz o plano de HOJE (`store.resetToday`; a sessão que já roda segue com o plano dela).
  - O número do modelo é o MÁXIMO do dia: `planFrom` só varia para baixo (até 2 não varia) e grava `plan.caps` (o teto
    escrito); `rules.limitOf` usa o menor entre 120% e `caps`. Toda iteração sobre o plano ignora `caps` (não é meta).
  - Transição (`custom.withRamp`, `goalRamp` na conta): depois de trocar/editar a meta, cada meta sobe no máximo +25% (mín.
    +1) sobre o último dia com sessão; descer é na hora; acaba no 1º dia sem nada segurado. Simulador: `account.switchAt`.
  - Gravar/apagar modelo (`store.editTemplates`) relê `user_config` antes e grava na hora, um por vez: aparelho
    desatualizado não apaga o modelo do outro. Nome repetido na mesma plataforma é recusado. Editar deixa no registro da
    conta o que mudou (`custom.diffTemplate`).
  - Recusado no motor e marcado como erro no editor (os dois iguais, conferido em teste): fora de `custom.LIMITS` e
    combinação impossível (`custom.impossible` = `impossiveis` em `web/src/lib/meta.ts`). Atenção e risco não bloqueiam.
  - Teto exato não tem folga: o TikTok reserva vídeos (Para Você guarda 1 por busca que falta, busca guarda 1 por follow
    que falta: `reserveFor`) e na "última chance" curte/segue com certeza (`likeLast`, `lastChance`); o Explorar do
    Instagram abre publicações para os follows que faltam (até `POSTS_MAX` = 15) e a última visita insiste. A bateria do
    simulador (metas pequenas a grandes, exatas e variando) tem de fechar 100% dos dias.
  - Testes: `tests/meta.test.js`, `tests/metas-transicao.test.js` (simulador trocando de meta), `tests/metas-aparelhos.test.js`
    (banco falso, `store._useClient`).
- Perguntas do painel: `store.ask` (janela do app, `components/Confirm.tsx`), nunca `confirm()`. Tela com mudança não
  salva: `setLeaveGuard(msg)` faz o menu, o voltar e fechar a janela perguntarem antes.
- `web/`: o painel (React + TypeScript + Vite). `src/store.tsx` (dados, tempo real, ações), `src/views/` (telas),
  `src/components/`, `src/lib/format.ts` (funções puras, testadas em `tests/web-format.test.ts`). Estilos em `src/styles.css`,
  com tokens de cor no `:root` e tema claro/escuro. Responsivo: funciona no celular, sem app instalável.
- `supabase/`: `schema-base.sql` + `migrations/` (em ordem).
- `desktop/`: o aplicativo do Windows (app 4/5). `main.js` sobe motor e painel (Node do próprio Electron,
  `ELECTRON_RUN_AS_NODE`), janela, bandeja com cor (`logic.trayState`), notificações, iniciar com o Windows,
  aparelho acordado durante sessões, bateria (<20% segura sessão nova: `motor/power.js`) e suspensão (para as sessões).
  Instalador com assistente em português (pasta, atalhos na Área de Trabalho e no Menu Iniciar, "abrir no final"); instalação
  nova vai para `%LOCALAPPDATA%\Programs\WarmUp Studio`, e as que já existem continuam na pasta delas (o NSIS lembra).
  Dados em `%APPDATA%\WarmUp Studio\data`. `installer.nsh`: sempre "só para mim" e desinstalar tira o início com o Windows
  (`${APP_ID}`; numa atualização não). Id do app (notificações, início com o Windows) = `wuAppId` do pacote.
  Fala com o motor por `/api/_device/tray` e `/api/_device/power` (o navegador não alcança). Registro do app: `data/logs/app.log`.
  `updater.js`: atualização pelo bucket público `downloads`. O plano gratuito do Supabase aceita até 50 MB por arquivo:
  o instalador vai em partes de 45 MB + `latest.json` (SHA-256 de cada parte e do todo) e é instalado em silêncio (`/S --force-run --updated`).
  Janela aberta: pergunta. Janela fechada e nada aberto (sem sessão nem navegador): instala sozinha e volta escondida.
  Antes de instalar grava `data/update-pending.json`; na volta confere a versão (`logic.pendingUpdate`), tenta de novo até 3 vezes.
  `scripts/instalar.ps1`: primeira instalação num aparelho novo (`irm .../downloads/instalar.ps1 | iex`). Ícones: `npm run icones`.
- Login do aparelho (`motor/cloud.js`): entrar de novo no painel SUBSTITUI o login guardado (trocar ou recuperar a senha derruba
  os outros logins no Supabase; o painel entrega o novo ao motor na hora). Login caído (`SIGNED_OUT` ou login salvo inválido):
  `needsLogin`, a API responde `needsDevice` e o painel mostra "Entrar de novo"; o ícone fica amarelo e avisa. Sem rede ao
  ligar: tenta de novo a cada 15 s (não pede login).
- `scripts/`: `servico.js` (PM2 e inicialização do Windows), `restaurar.js`, `publicar.js`, `app.js`. `ecosystem.config.js`: PM2.
- `data/`: fora do Git. `profiles/<id>` (sessões logadas), `screens/<id>` (prints), `logs/` (PM2).

Instalar e usar o aplicativo (passo a passo do dono): `GUIA-INSTALACAO.md`.

## Regras

- Lançamento em duas etapas: `npm run publicar` vai só para o canal de teste (`latest-teste.json`; aparelhos com
  "Receber atualizações em teste" no ícone, o PC do dono). `npm run liberar` (copia o aviso de teste para `latest.json`,
  todos os aparelhos) NUNCA sem o dono dizer que testou e está tudo ok. Outros computadores do dono rodam no estável e
  ele não tem acesso a eles: nada pode chegar lá sem passar pelo teste.
- Toda versão nova tem entrada em `web/src/novidades.ts` (aba "O que há de novo?"); o `publicar` para se faltar.

- O ID de uma conta e a pasta `data/profiles/<id>` nunca mudam: mudar perde o login.
- Instalador e atualização: NUNCA testar com o id de verdade (`com.warmupstudio.app`). O NSIS acha a instalação pelo id e
  desinstala a do dono mesmo com `/D=` em outra pasta. Testar com uma cópia de outra identidade: `-c.appId=com.warmupstudio.teste`,
  `productName`, `win.executableName`, `nsis.shortcutName` e `extraMetadata` (`name`, `productName`, `wuAppId`, `version`) próprios,
  e portas/servidor de atualização no `app-settings.json` dela (`panelPort`, `motorPort`, `updateBase`).
- Testes nunca abrem o TikTok ou o Instagram. `tests/navegador.test.js` e `tests/navegador-instagram.test.js` usam um
  Chromium de verdade com uma página local que imita o site (toda requisição é respondida no teste): é ele que pega clique
  que não chega no site. A página falsa do Instagram copia a estrutura lida no site de verdade (comentário no topo de
  `motor/platforms/instagram.js`); conferir de novo no site exige o dono liberar, uma CÓPIA do perfil (nunca a pasta
  da conta) e só olhar dentro do plano do dia (meta de curtida e follow zerada).
- Curtida e follow só contam se o site mostrou que pegaram (TikTok: `aria-pressed`; Instagram: "Curtir" vira "Descurtir",
  "Seguir" vira "Seguindo"/"Solicitado"). Janela do Instagram (post, comentários, story) fecha no X, Esc só sem o X na tela.
  Instagram pelo computador: dois cliques no reel NÃO curtem (curtida sempre no coração) e a rodinha só troca de reel com
  o mouse em cima do vídeo; o reel só conta de novo se o endereço mudou (`reelStep`), senão a atividade para.
- Sessão para na meta: as atividades conferem `ctl.goalsDone()` no meio do que fazem. Instagram nunca passa do plano
  (reels só enquanto falta reel; curtida que falta sai do feed/Explorar). TikTok pode ver vídeos a mais para fechar as
  curtidas, até o teto de 120%.
- Falha repetida (a mesma 3x numa sessão) e sessão que vê vídeos sem curtir viram alerta no painel (`ctl.fail`, `rules.noLikeWarning`).
- Não aumentar a atividade das contas além do plano de fases. Humanizar muda COMO e QUANDO, nunca QUANTO
  (o simulador e tests/human.test.js conferem o teto de 120%). Nenhuma meta passa de 120% do plano do dia (`rules.GOAL_CAP`).
- Captcha, bloqueio ou falta de login: a sessão para na hora e a conta fica com `attention` até o dono resolver
  (captcha: botão "Abrir navegador"; bloqueio: "Liberar"; login: "Login"). Nada volta sozinho.
  Captcha no meio da sessão: o robô não mexe em mais nada, mostra a janela da conta na tela (`runner.captchaWait`,
  `motor/humanwait.js`) e espera o dono resolver SEM limite (a janela nunca fecha sozinha: captcha abandonado pesa contra a conta); resolvido, a
  sessão continua. Faixa no painel com "Mostrar a janela"; a sessão que espera não ocupa vaga (`runner.busySessions`).
  Robô nunca resolve captcha.
- TikTok pode mostrar "Seguindo" e descartar o follow (conta nova/desconfiada: é da conta, não do robô): follow só conta
  se o botão mudou e, em dia com follow, a sessão confere o "Seguindo" do próprio perfil no começo e no fim;
  não subiu = aviso no painel (`FOLLOW_NOT_SAVED`, texto fixo: as sessões somam no mesmo aviso) dizendo que é da conta e
  para testar seguir pelo celular. NÃO pausa os follows (o dono pediu para tirar essa restrição em 2026-10-10).
- Navegador nunca headless (sem janela o Edge se apresenta como "HeadlessChrome"): "Esconder as janelas" abre fora da
  tela (`rules.windowMode`).
- Navegador: Microsoft Edge instalado no Windows (`channel: 'msedge'`), sem user-agent inventado: ele se apresenta como
  ele mesmo. Tela de cada conta sorteada entre as de PC com Windows. Não trocar de navegador sem o dono: muda o "aparelho" das contas.
- Nunca trocar o proxy de uma conta sozinho: proxy fora do ar faz a conta esperar ("proxy-fora").
- Proxy no navegador: SOCKS5 com usuário e senha é recusado no cadastro (o Playwright não abre o navegador assim; HTTP com
  senha funciona). Conta com proxy: o fuso do navegador é o do IP de saída (`proxycheck.proxyUpdate` grava país e fuso
  quando o IP muda; `runner.proxyPlace` testa antes de abrir se o fuso ainda não é conhecido) e o WebRTC só sai pelo proxy
  (`webrtc.js`: preferência no perfil; a opção `--force-webrtc-ip-handling-policy` NÃO vale no Edge, conferido).
- Backup só com tudo parado (Chrome aberto trava os arquivos). Restauração nunca apaga a pasta atual.
- Banco: mudança de estrutura só por migração nova em `supabase/migrations`, aplicada pelo MCP do Supabase.
  Testar antes numa transação desfeita e rodar o verificador de segurança (advisors) depois.
- O app usa só a chave PÚBLICA + o login do usuário; as regras por dono no banco protegem os dados. A chave secreta
  nunca entra no app (no `.env`, só para testes e manutenção) e o `.env` nunca vai para o Git.
- Cada fase termina com testes e lint passando, commit e push.
- QA ao vivo: nunca entrar pelo PAINEL com usuário de teste enquanto houver contas sem dono (`owner_id` null): o painel
  chama `claim_legacy_accounts` e o usuário de teste vira dono das contas antigas. Logar o teste direto pelo supabase-js.

## Como trabalhamos (vale para qualquer IA neste projeto)

O dono alterna entre o Claude e outra IA. Quem pegar o projeto segue este roteiro e ANOTA tudo em `NOTAS-IA.md`
(o que fez, o que testou, o que ficou pendente), para a próxima IA continuar de onde parou. Respostas ao dono em
português do Brasil, simples, sem jargão.

### Roteiro de cada mudança
1. Ler este arquivo inteiro e o `NOTAS-IA.md` (entradas do topo primeiro). `git log --oneline -15` mostra o que mudou.
2. Achar o código certo antes de mexer (as seções "Estrutura" e "Regras" acima dizem onde fica cada coisa).
3. Mudança de regra ou lógica: escrever primeiro um teste que FALHA mostrando o problema, depois corrigir até passar.
4. `npm test`, `npm run lint`, `npm run typecheck`. Mexeu no painel: `npm run build`. `npx prettier --write <arquivos>`.
   - `tests/navegador-login.test.js` às vezes falha só junto com a suíte inteira; sozinho
     (`node --test tests/navegador-login.test.js`) passa. Qualquer OUTRA falha tem de ser resolvida.
5. Subir a versão em `package.json` e `package-lock.json` (as 2 primeiras ocorrências de "version") e escrever a
   entrada em `web/src/novidades.ts` (no topo, na linguagem do dono: o que ele vai notar).
6. Commit em português no estilo dos anteriores, push.
7. `npm run publicar` (vai só para o CANAL DE TESTE). Conferir `latest-teste.json` com a versão nova e `latest.json`
   (estável) sem mudar.
8. Dizer ao dono o que testar. `npm run liberar` SÓ quando ele disser que testou e está tudo ok.
9. Anotar em `NOTAS-IA.md`.

### Os 5 tipos de teste (do mais barato ao mais caro)
1. **Regras puras** (`tests/rules.test.js`, `meta.test.js`, `web-format.test.ts` e outros): `node:test` +
   `assert/strict` sobre funções de `motor/rules.js`, `motor/custom.js`, `web/src/lib/*.ts`. Rápidos, rodar sempre.
2. **Simulador** (`motor/sim/simulate.js`): roda o código REAL das plataformas com relógio e página falsos, dias
   inteiros, sem navegador. `simulate({ account: { platform, username, interests, template, switchAt: { day, template } }, days, seed })`
   devolve `{ daily, sessions }`. Serve para: teto do dia (`rules.limitOf`), dia que fecha (`rules.completion === 1`),
   transição de meta, Rotina. A bateria de `tests/metas-transicao.test.js` (metas pequenas a grandes, exatas e
   variando, TikTok e Instagram) tem de fechar 100% dos dias. Para investigar um dia que não fechou: rodar a semente
   que falhou e olhar `sessions[i].logs`, `.actions` e `.reason` (`goals` = bateu; `limit` = travou no teto; `cap` =
   tempo). Para ver o agendador, embrulhar `rules.decide` e imprimir o motivo a cada mudança.
3. **Navegador com página falsa** (`tests/navegador.test.js` para o TikTok, `navegador-instagram.test.js`): Chromium
   do Playwright; toda requisição é respondida pelo teste com uma página que imita a estrutura do site (nada vai para
   a internet). Caso novo do site: acrescentar o pedaço na página falsa (ex.: `?bandeja=nova` na home do Instagram) e
   um teste chamando a atividade (ex.: `instagram._activities.stories({ page, bot, ctl })`).
4. **Banco falso** (`tests/metas-aparelhos.test.js`): `store._useClient(fake)` com um cliente que imita o supabase-js.
   Para lógica do `store.js` que grava ou relê o banco.
5. **Ao vivo** (só com o dono autorizando; nunca nos testes automáticos):
   - **Painel de verdade**: motor + painel do projeto em portas e pasta de dados à parte (`WU_DATA_DIR`,
     `MOTOR_PORT`, `PORT`), Playwright no painel, usuário de TESTE (credenciais: pedir ao dono; nunca no Git), contas
     de teste criadas pela API e apagadas no fim. Respeitar a regra de QA ao vivo (contas sem dono).
   - **Sessão real numa conta**: só numa CÓPIA da pasta do perfil (`%APPDATA%\WarmUp Studio\data\profiles\<id>`;
     `robocopy <origem> <destino> /E /XD Cache "Code Cache" GPUCache`), Edge, `createCtl` real + `platform.run`, plano
     de `planForDay(dia, rng, modelo)`. Antes: conferir que o app do dono não está com sessão dessa conta
     (`accounts.status.live` e `data.nextAfter` no banco) e rodar longe do próximo horário. Depois: apagar a cópia (tem
     o login da conta). Contas liberadas pelo dono para teste: @alemdofato5 (Instagram) e @skateanimals2 (TikTok).
   - **Instalador e atualização**: só com a cópia de outra identidade (regra acima).

### Dicas de ambiente (Windows)
- Arquivo com barra invertida (regex, caminhos): editar pelo editor ou por script Python gravado em arquivo; o heredoc
  do bash come as barras. Gravar UTF-8 sem BOM.
- App instalado do dono: dados em `%APPDATA%\WarmUp Studio\data` (motor na porta 3101, senha interna em `motor.token`).
- Investigar o banco: `node -e` com `@supabase/supabase-js` e a chave do `.env`, só leitura (estrutura só por migração).
- O PC do dono recebe o canal de teste pelo ícone perto do relógio → "Receber atualizações em teste".

### Estado em 2026-10-10 (o mais novo fica em NOTAS-IA.md)
- Estável (todos os aparelhos): 2.1.2. Canal de teste: 2.1.7. Aguardando o dono testar para `npm run liberar`.
- Ao liberar: apagar o usuário de teste `wu.teste.1791651493829@gmail.com` e os aparelhos dele (autorizado só nesse
  momento). A migração `20261010180000_relatorios_dos_aparelhos.sql` (tabela `app_reports`) NÃO foi aplicada: o dono
  recusou; perguntar antes.
- Pedidos pendentes do dono: instalador que confere no servidor a versão mais nova antes de instalar; compactar os
  arquivos do app (asar), testando antes com a cópia de outra identidade.

### Prompt para a outra IA (o dono cola isto)
```
Você vai continuar o projeto WarmUp Studio nesta pasta. Antes de qualquer coisa:
1. Leia o CLAUDE.md inteiro (estrutura, regras e a seção "Como trabalhamos") e o NOTAS-IA.md.
2. Rode npm test, npm run lint e npm run typecheck e me diga se está tudo passando.
As regras da seção "Regras" do CLAUDE.md não podem ser quebradas (principalmente: publicar só no canal de teste e
nunca rodar npm run liberar sem eu mandar; nunca testar o instalador com o id de verdade; testes nunca abrem
TikTok/Instagram; sessão real só em CÓPIA do perfil e com minha autorização; nada de segredo no Git).
Para cada pedido meu, siga o "Roteiro de cada mudança" do CLAUDE.md: teste que falha primeiro, depois a correção,
testes/lint/typecheck, versão + novidades.ts, commit e npm run publicar.
Ao terminar cada tarefa, escreva uma entrada no topo do NOTAS-IA.md (data, o que pedi, o que mudou e em quais
arquivos, como testou e o resultado, versão publicada, o que ficou pendente) e atualize o CLAUDE.md se mudou alguma
regra ou estrutura.
Fale comigo em português do Brasil, simples. Minha tarefa agora é: <escreva aqui>
```
