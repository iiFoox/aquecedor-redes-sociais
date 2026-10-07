# Aquecedor Redes Sociais

Painel para aquecer contas de TikTok e Instagram com Playwright, salvando tudo no Supabase.

## Rodar

```
npm install
cp .env.example .env   # preencha com a URL e a chave SECRETA do Supabase
node server.js
```

Painel em http://localhost:3001

## Supabase

- Setup do banco: cole `setup/supabase.sql` no SQL Editor do Supabase e clique em Run.
- MCP: já configurado em `.mcp.json`. No Claude Code, rode `/mcp` → supabase → Authenticate.

## Login das contas

As sessões logadas ficam em `data/profiles/` e **não vão para o Git** (contêm cookies).
Em uma máquina nova, faça o login de cada conta de novo pelo painel.
