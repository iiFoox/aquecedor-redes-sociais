# WarmUp Studio (Aquecedor Redes Sociais)

Aquece contas do TikTok e do Instagram com Playwright, seguindo um plano de 5 fases (pronta no dia 22).
Uso pessoal do dono, nas contas dele. Interface e mensagens em português do Brasil.

## Rodar

```
npm install
cp .env.example .env   # SUPABASE_URL + chave SECRETA do Supabase
npm run app            # o aplicativo do Windows (Electron) a partir do projeto
npm run instalador     # gera release/WarmUp-Studio-Setup-<versão>.exe (confere que nenhum segredo vai junto)
npm run publicar       # gera e publica no bucket "downloads" (suba "version" no package.json antes)
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
  - `sim/`: simulador com relógio e página falsos (`npm run simular -- <conta|nova-tiktok> <dias>`). Roda o código real das plataformas.
  - `backup.js`: backup diário dos perfis (04:00, sem cache, 7 últimos). `proxycheck.js`: teste de proxy sem navegador.
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
    renovada a cada minuto pelo `publisher.js`, solta ao fechar. "Rodar neste aparelho" espera a trava do outro vencer.
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
- `web/`: o painel (React + TypeScript + Vite). `src/store.tsx` (dados, tempo real, ações), `src/views/` (telas),
  `src/components/`, `src/lib/format.ts` (funções puras, testadas em `tests/web-format.test.ts`). Estilos em `src/styles.css`,
  com tokens de cor no `:root` e tema claro/escuro. Responsivo: funciona no celular, sem app instalável.
- `supabase/`: `schema-base.sql` + `migrations/` (em ordem).
- `desktop/`: o aplicativo do Windows (app 4/5). `main.js` sobe motor e painel (Node do próprio Electron,
  `ELECTRON_RUN_AS_NODE`), janela, bandeja com cor (`logic.trayState`), notificações, iniciar com o Windows,
  aparelho acordado durante sessões, bateria (<20% segura sessão nova: `motor/power.js`) e suspensão (para as sessões).
  Dados em `%APPDATA%WarmUp Studiodata`. Fala com o motor por `/api/_device/tray` e `/api/_device/power` (o navegador não alcança).
  `updater.js`: atualização pelo bucket público `downloads`. O plano gratuito do Supabase aceita até 50 MB por arquivo:
  o instalador vai em partes de 45 MB + `latest.json` (SHA-256 de cada parte e do todo) e é instalado em silêncio (`/S --force-run`).
  `scripts/instalar.ps1`: primeira instalação num aparelho novo (`irm .../downloads/instalar.ps1 | iex`). Ícones: `npm run icones`.
- `scripts/`: `servico.js` (PM2 e inicialização do Windows), `restaurar.js`, `publicar.js`, `app.js`. `ecosystem.config.js`: PM2.
- `data/`: fora do Git. `profiles/<id>` (sessões logadas), `screens/<id>` (prints), `logs/` (PM2).

Instalar e usar o aplicativo (passo a passo do dono): `GUIA-INSTALACAO.md`.

## Regras

- O ID de uma conta e a pasta `data/profiles/<id>` nunca mudam: mudar perde o login.
- Testes nunca abrem o TikTok ou o Instagram. `tests/navegador.test.js` usa um Chromium de verdade com uma página local que
  imita o TikTok (toda requisição é respondida no teste): é ele que pega clique que não chega no site.
- Falha repetida (a mesma 3x numa sessão) e sessão que vê vídeos sem curtir viram alerta no painel (`ctl.fail`, `rules.noLikeWarning`).
- Não aumentar a atividade das contas além do plano de fases. Humanizar muda COMO e QUANDO, nunca QUANTO
  (o simulador e tests/human.test.js conferem o teto de 120%). Nenhuma meta passa de 120% do plano do dia (`rules.GOAL_CAP`).
- Captcha, bloqueio ou falta de login: a sessão para na hora e a conta fica com `attention` até o dono resolver
  (captcha: botão "Abrir navegador"; bloqueio: "Liberar"; login: "Login"). Nada volta sozinho.
- Navegador: Microsoft Edge instalado no Windows (`channel: 'msedge'`), sem user-agent inventado: ele se apresenta como
  ele mesmo. Tela de cada conta sorteada entre as de PC com Windows. Não trocar de navegador sem o dono: muda o "aparelho" das contas.
- Nunca trocar o proxy de uma conta sozinho: proxy fora do ar faz a conta esperar ("proxy-fora").
- Backup só com tudo parado (Chrome aberto trava os arquivos). Restauração nunca apaga a pasta atual.
- Banco: mudança de estrutura só por migração nova em `supabase/migrations`, aplicada pelo MCP do Supabase.
  Testar antes numa transação desfeita e rodar o verificador de segurança (advisors) depois.
- O app usa só a chave PÚBLICA + o login do usuário; as regras por dono no banco protegem os dados. A chave secreta
  nunca entra no app (no `.env`, só para testes e manutenção) e o `.env` nunca vai para o Git.
- Cada fase termina com testes e lint passando, commit e push.
- QA ao vivo: nunca entrar pelo PAINEL com usuário de teste enquanto houver contas sem dono (`owner_id` null): o painel
  chama `claim_legacy_accounts` e o usuário de teste vira dono das contas antigas. Logar o teste direto pelo supabase-js.
