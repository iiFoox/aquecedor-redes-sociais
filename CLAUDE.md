# WarmUp Studio (Aquecedor Redes Sociais)

Aquece contas do TikTok e do Instagram com Playwright, seguindo um plano de 5 fases (pronta no dia 22).
Uso pessoal do dono, nas contas dele. Interface e mensagens em português do Brasil.

## Rodar

```
npm install
cp .env.example .env   # SUPABASE_URL + chave SECRETA do Supabase
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
  - `human.js`: comportamento humano (pausas de cauda longa, personalidade da conta, destino de cada vídeo, rolagem com inércia).
    `bot.js` usa isso; `ctl.js` é o controle da sessão (o mesmo na sessão real e no simulador).
  - `sim/`: simulador com relógio e página falsos (`npm run simular -- <conta|nova-tiktok> <dias>`). Roda o código real das plataformas.
  - `backup.js`: backup diário dos perfis (04:00, sem cache, 7 últimos). `proxycheck.js`: teste de proxy sem navegador.
  - `platforms/`: TikTok e Instagram. Cada atividade declara as metas que conta (`produces`) e as que adianta (`advances`).
  - `api/`: rotas. `validate.js`: validação (zod) de tudo que entra.
- `painel/`: serve `web/dist` e repassa `/api` ao motor. Se o motor cair, o painel continua no ar.
- `web/`: o painel (React + TypeScript + Vite). `src/store.tsx` (dados, tempo real, ações), `src/views/` (telas),
  `src/components/`, `src/lib/format.ts` (funções puras, testadas em `tests/web-format.test.ts`). Estilos em `src/styles.css`,
  com tokens de cor no `:root` e tema claro/escuro. Responsivo: funciona no celular, sem app instalável.
- `supabase/`: `schema-base.sql` + `migrations/` (em ordem).
- `scripts/`: `servico.js` (PM2 e inicialização do Windows) e `restaurar.js`. `ecosystem.config.js`: PM2.
- `data/`: fora do Git. `profiles/<id>` (sessões logadas), `screens/<id>` (prints), `logs/` (PM2).

## Regras

- O ID de uma conta e a pasta `data/profiles/<id>` nunca mudam: mudar perde o login.
- Testes nunca abrem o TikTok ou o Instagram.
- Não aumentar a atividade das contas além do plano de fases. Humanizar muda COMO e QUANDO, nunca QUANTO
  (o simulador e tests/human.test.js conferem o teto de 120%). Nenhuma meta passa de 120% do plano do dia (`rules.GOAL_CAP`).
- Captcha, bloqueio ou falta de login: a sessão para na hora e a conta fica com `attention` até o dono resolver
  (captcha: botão "Abrir navegador"; bloqueio: "Liberar"; login: "Login"). Nada volta sozinho.
- Nunca trocar o proxy de uma conta sozinho: proxy fora do ar faz a conta esperar ("proxy-fora").
- Backup só com tudo parado (Chrome aberto trava os arquivos). Restauração nunca apaga a pasta atual.
- Banco: mudança de estrutura só por migração nova em `supabase/migrations`, aplicada pelo MCP do Supabase.
  Testar antes numa transação desfeita e rodar o verificador de segurança (advisors) depois.
- O Supabase fica fechado para a chave pública. O `.env` usa a chave secreta e nunca vai para o Git.
- Cada fase termina com testes e lint passando, commit e push.
