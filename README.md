# Aquecedor Redes Sociais (WarmUp Studio)

Painel para aquecer contas do TikTok e do Instagram com Playwright, salvando tudo no Supabase.

## Rodar

```
npm install
cp .env.example .env   # preencha com a URL e a chave SECRETA do Supabase
npm start
```

Painel em http://localhost:3001. O `npm start` sobe dois programas:

- **motor**: o robô (navegadores, agendador e banco). Só aceita conexões desta máquina.
- **painel**: o site. Se o motor cair ou reiniciar, o painel continua no ar e avisa.

`Ctrl+C` fecha as sessões com segurança e grava o que falta antes de sair.

## Quando a conta precisa de você

- **Captcha**: a sessão para na hora. Clique em **Abrir navegador**, resolva o captcha e feche a janela. A conta volta para a fila.
- **Bloqueio de ações**: a conta fica parada até você clicar em **Liberar**.
- **Sem login**: clique em **Login** e entre na conta. A janela fecha sozinha quando o login é detectado.

## Supabase

- Estrutura: `supabase/schema-base.sql` e depois as migrações de `supabase/migrations`, em ordem.
- MCP: configurado em `.mcp.json`. No Claude Code, rode `/mcp` → supabase → Authenticate.

## Desenvolvimento

```
npm test        # testes
npm run lint    # ESLint
npm run format  # Prettier
```

## Login das contas

As sessões logadas ficam em `data/profiles/` e **não vão para o Git** (contêm cookies).
Em uma máquina nova, faça o login de cada conta de novo pelo painel.
