# WarmUp Studio: instalar e usar o aplicativo do Windows

Cada aparelho (PC, notebook) roda as **próprias** contas, ao mesmo tempo. Todos entram com o mesmo e-mail e senha e
enxergam tudo pelo painel. Uma conta nunca roda em dois aparelhos ao mesmo tempo (o app trava).

## 1. Uma vez só, no Supabase (painel do site supabase.com)

1. **Authentication → Sign In / Providers → Email:** desligue **Confirm email** (senão o cadastro pede confirmação por e-mail).
2. **Authentication → URL Configuration → Redirect URLs:** adicione `http://localhost:3001/**` (link do "Esqueci a senha").

## 2. No PC (onde as contas rodam hoje)

1. **Desligue a versão de terminal** (na pasta do projeto, no PowerShell):
   ```
   npm run desligar
   npm run autostart:desligar
   ```
   As duas usam as mesmas portas; com a de terminal ligada, o app avisa e não abre.
2. **Leve os logins que já existem** (assim não precisa entrar de novo nas contas). Com o Edge das contas fechado:
   ```
   robocopy "C:\Users\vfbnn\.gemini\antigravity-ide\scratch\insta-warmer\data\profiles" "$env:APPDATA\WarmUp Studio\data\profiles" /E
   ```
3. **Instale:** dê dois cliques em `release\WarmUp-Studio-Setup-2.1.2.exe` (ou use o comando do item 3, abaixo).
   O Windows mostra "O Windows protegeu o computador" (o app não tem assinatura paga): **Mais informações → Executar assim mesmo**.
   O instalador, em português, mostra a pasta (pode trocar) e cria os atalhos na Área de Trabalho e no Menu Iniciar.
   Não pede administrador e abre o app no final.
4. **Primeira abertura:**
   - **Criar conta** com o seu e-mail e senha. O 1º usuário do projeto fica com as contas antigas (alemdofato5 e skateanimals2).
   - Dê um **nome ao aparelho** (ex.: "PC do quarto").
   - Em cada conta: **Rodar neste aparelho**.
   - Ligue o **piloto automático**, como antes.

## 3. No notebook (ou em qualquer aparelho novo)

1. Abra o **PowerShell** e cole:
   ```
   irm https://cuuuudyjqjyeqvvfqtkl.supabase.co/storage/v1/object/public/downloads/instalar.ps1 | iex
   ```
   Ele baixa o instalador em partes, confere cada uma e abre o instalador (mesmo aviso do Windows: **Executar assim mesmo**).
2. **Entrar** com o mesmo e-mail e senha (não criar conta nova). Dê um nome ao aparelho.
3. Cadastre as contas que vão rodar nele, ou traga uma conta do PC com **Rodar neste aparelho** (o PC solta a conta e o
   login dela vem junto do Supabase, sem pedir login de novo).
4. Notebook: o app avisa uma vez sobre a tampa. Fechada, o Windows costuma dormir e as sessões param direito antes.
   Para rodar de tampa fechada: **Opções de energia → Ao fechar a tampa: Nada a fazer** (na tomada).

## 4. O que conferir depois de instalar

- **Ícone perto do relógio:** verde (tudo certo), amarelo (alguma conta precisa de você, bateria fraca ou chave trancada),
  vermelho (captcha ou bloqueio), cinza (ligando). Clique com o botão direito para ver o resumo, ligar/desligar
  **Iniciar com o Windows**, **Procurar atualização** e **Sair**.
- **Fechar a janela não para o robô:** ele continua perto do relógio. Para parar de verdade: botão direito → Sair.
- **Ajustes → Logins na nuvem:** "Ligado".
- **Página de cada conta:** "Login salvo no Supabase às HH:MM" aparece depois do 1º login ou da 1ª sessão.
- **Notificações:** captcha, bloqueio e pedido de login aparecem no Windows; clicar abre a conta.
- **Bateria abaixo de 20%:** o robô não abre sessão nova até ligar na tomada.

## 5. Publicar uma versão nova (quando houver mudança no código)

1. Suba a versão em `package.json` (ex.: `"version": "2.0.1"`).
2. `npm run publicar` (gera, confere que nenhum segredo vai junto e envia em partes para o Supabase).
3. Os aparelhos baixam sozinhos (1 min depois de abrir e a cada 6 h). Com a janela aberta, perguntam "Atualizar agora".
   Com a janela fechada, instalam sozinhos assim que nenhuma conta estiver aquecendo e voltam escondidos, já logados.
   Para não esperar: ícone → Procurar atualização. Nada se perde: os dados ficam em `%APPDATA%\WarmUp Studio\data`.

## 6. Se algo der errado

- **"O WarmUp Studio já está rodando neste PC pelo terminal":** `npm run desligar` na pasta do projeto e abra o app de novo.
- **Ícone vermelho com "o motor parou várias vezes":** ícone → Abrir a pasta dos registros → `motor.log`.
- **"Este aparelho está sem login" (faixa no painel, ícone amarelo):** acontece quando a senha é trocada ou recuperada em outro
  lugar (o Supabase derruba os logins antigos). Clique em **Entrar de novo** e entre com a senha atual: as contas voltam a aquecer.
- **Algo estranho numa atualização:** ícone → Abrir a pasta dos registros → `app.log` (cada passo da atualização fica anotado).
- **"Chave trancada" em Logins na nuvem:** este aparelho ficou sem a chave dos logins (ela foi trocada em outro
  aparelho, ou a senha foi recuperada pelo "Esqueci a senha"). Clique em **Destrancar com a senha atual**. Se não abrir,
  **Tenho a senha antiga**. Último caso: **Começar chave nova** (as contas sem pasta neste aparelho pedem login de novo).
- **Desinstalar:** Configurações do Windows → Aplicativos → WarmUp Studio. Os dados em `%APPDATA%\WarmUp Studio` ficam.
