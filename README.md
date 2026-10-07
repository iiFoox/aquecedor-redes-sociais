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

## Rodar em segundo plano (dia a dia)

```
npm run ligar               # liga motor + painel; reiniciam sozinhos se caírem
npm run desligar            # desliga com segurança
npm run status              # está rodando?
npm run logs                # registros (ficam em data/logs)
npm run autostart:ligar     # liga sozinho quando você entra no Windows
npm run autostart:desligar  # tira da inicialização
```

Use **ou** `npm start` **ou** `npm run ligar`, nunca os dois ao mesmo tempo (as portas são as mesmas).

## Proteções

- **Backup dos logins**: todo dia às 04:00, `data/profiles` sem cache (~1 MB) vai para `OneDrive\Backups\WarmUp Studio`.
  Guarda os 7 mais recentes. Só roda com tudo parado; enquanto estiver pendente, o piloto não abre sessões novas.
  Para restaurar: desligue o motor e rode `npm run restaurar` (lista), `npm run restaurar -- ultimo` (tudo)
  ou `npm run restaurar -- ultimo alemdofato5` (só uma conta). A pasta atual nunca é apagada: vira `...-antes-<data>`.
- **Vigia**: sessão 15 min sem sinal, ou 5 min além do teto de segurança, tem o navegador fechado. Fica registrada como "Travou".
- **Prints**: captcha, bloqueio, erro e sessão travada guardam um print em `data/screens/<conta>` (os 30 últimos), visível no detalhe da conta.
- **Proxies**: testados a cada 30 min sem abrir navegador. Conta com proxy fora do ar espera ele voltar; nunca troca de IP sozinha.
- **Horário por conta**: no detalhe da conta, "Horário próprio" substitui o horário geral só para ela.
- **Modo férias** (Agendamento): nada roda até a data de volta, e cada conta continua do dia do aquecimento em que parou.

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
