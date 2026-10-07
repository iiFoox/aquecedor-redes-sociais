# WarmUp Studio (Aquecedor Redes Sociais)

Aquece contas do TikTok e do Instagram com Playwright, seguindo um plano de 5 fases (pronta no dia 22).
Uso pessoal do dono, nas contas dele. Interface e mensagens em português do Brasil.

## Rodar

```
npm install
cp .env.example .env   # SUPABASE_URL + chave SECRETA do Supabase
npm start              # motor + painel; painel em http://localhost:3001
npm test               # testes (node:test)
npm run lint           # ESLint
npm run format         # Prettier
```

## Estrutura

- `motor/`: o robô. Playwright, agendador, banco. Escuta só em 127.0.0.1:3101.
  - `rules.js`: regras puras (dia, plano, teto de 120%, saúde, alertas, decisão do agendador). Toda lógica testável vai aqui.
  - `store.js`: estado em memória + gravação em lote no Supabase.
  - `runner.js`: sessões e navegador manual (login/captcha). `scheduler.js`: piloto automático.
  - `platforms/`: TikTok e Instagram. Cada atividade declara as metas que conta (`produces`) e as que adianta (`advances`).
  - `api/`: rotas. `validate.js`: validação (zod) de tudo que entra.
- `painel/`: serve `public/` e repassa `/api` ao motor. Se o motor cair, o painel continua no ar.
- `public/`: front atual (será trocado na fase 3).
- `supabase/`: `schema-base.sql` + `migrations/` (em ordem).
- `data/profiles/<id>`: sessões logadas do navegador. Fora do Git.

## Regras

- O ID de uma conta e a pasta `data/profiles/<id>` nunca mudam: mudar perde o login.
- Testes nunca abrem o TikTok ou o Instagram.
- Não aumentar a atividade das contas além do plano de fases. Nenhuma meta passa de 120% do plano do dia (`rules.GOAL_CAP`).
- Captcha, bloqueio ou falta de login: a sessão para na hora e a conta fica com `attention` até o dono resolver
  (captcha: botão "Abrir navegador"; bloqueio: "Liberar"; login: "Login"). Nada volta sozinho.
- Banco: mudança de estrutura só por migração nova em `supabase/migrations`, aplicada pelo MCP do Supabase.
  Testar antes numa transação desfeita e rodar o verificador de segurança (advisors) depois.
- O Supabase fica fechado para a chave pública. O `.env` usa a chave secreta e nunca vai para o Git.
- Cada fase termina com testes e lint passando, commit e push.
