# Notas das IAs (diário do projeto)

Cada IA que trabalhar no projeto escreve aqui, no TOPO, uma entrada por tarefa:
data · pedido do dono · o que mudou (arquivos) · como testou e resultado · versão publicada (canal) · pendências.
A próxima IA lê isto antes de começar (junto com o CLAUDE.md, seção "Como trabalhamos").

## 2026-10-10 · Claude
- Pedido: metas personalizadas fechando certinho (principalmente TikTok); TikTok sem pausa de follows, com aviso.
- Feito: transição suave ao trocar de meta, número escrito = máximo do dia, modelos sem conflito entre aparelhos,
  editor novo, reservas de vídeo do TikTok (busca/follow), Explorar do Instagram abre publicações para os follows,
  Rotina não fica presa no intervalo sorteado, stories do Instagram voltam ao topo e preferem os não vistos,
  aviso "TikTok não grava follows desta conta" sem pausar.
- Testes: suíte inteira passando (a falha ocasional é só `navegador-login`, que passa sozinho); bateria do simulador
  (80 sementes × 24 metas × 2 dias) fechou 100%; painel ao vivo 35/35; sessões reais fecharam a meta no TikTok
  (@skateanimals2, personalizada e recomendada) e no Instagram (@alemdofato5, com follows pelo Explorar).
- Publicado: 2.1.6 e 2.1.7 no canal de teste. Estável continua 2.1.2.
- Pendente: dono testar e mandar liberar; apagar o usuário de teste ao liberar; instalador que confere a versão no
  servidor antes de instalar; compactação (asar) testada antes com a cópia de outra identidade.
