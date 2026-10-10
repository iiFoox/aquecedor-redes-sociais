// "O que há de novo?": tudo o que mudou em cada versão do app, da mais nova para a mais antiga.
// Toda versão nova ganha uma entrada AQUI antes de publicar (o "npm run publicar" confere e para se faltar).
export interface Novidade {
  versao: string;
  data: string; // AAAA-MM-DD
  titulo: string;
  itens: string[];
}

export const NOVIDADES: Novidade[] = [
  {
    versao: '2.1.6',
    data: '2026-10-10',
    titulo: 'Metas personalizadas mais seguras e mais fáceis de usar',
    itens: [
      'Trocar de meta no meio do caminho não pula mais de fase de uma vez: os números sobem aos poucos (no máximo +25% por dia sobre o último dia com sessão). Descer é na hora. A conta mostra "em transição" enquanto isso.',
      'O número que você escreve é o MÁXIMO do dia: "variar um pouco por dia" só desce (até ~10%), números até 2 não variam e o teto do dia é o próprio número (sem os 120% da recomendada).',
      'Dois computadores mexendo nos modelos ao mesmo tempo não apagam mais o modelo um do outro.',
      'Combinações impossíveis são recusadas (TikTok: mais curtidas que vídeos, mais follows que vídeos + perfis; Instagram: follow sem Explorar), e nome de modelo não repete.',
      'Editar um modelo deixa no registro de cada conta o que mudou ("curtidas fase 3 de 20 para 30"); o cartão mostra quando foi editado.',
      'Editor novo: pontos de partida (Cautelosa 30 dias, Recomendada 22, Rápida 15), prévia em gráfico dia a dia com a recomendada atrás e os totais, aviso de cada número ao clicar nele, limite marcado na hora, resumo dos avisos perto do salvar e a caixinha do risco só quando há aviso.',
      'Escolha as contas direto no modelo ("Aplicar em contas"), vendo em que aparelho cada uma roda e para que fase ela vai.',
      'Sair do editor com mudança não salva pergunta antes; as perguntas do app agora aparecem numa janela do próprio app.',
      'No celular, o editor mostra uma fase por cartão. "O que há de novo?" ocupa a largura toda da página.',
    ],
  },
  {
    versao: '2.1.5',
    data: '2026-10-10',
    titulo: '"O que há de novo?" mais fácil de ler',
    itens: ['As versões aparecem em linha do tempo, uma embaixo da outra, com a mais nova em destaque no topo.'],
  },
  {
    versao: '2.1.4',
    data: '2026-10-10',
    titulo: 'Metas personalizadas',
    itens: [
      'Nova aba "Metas personalizadas": crie modelos com o seu prazo (de 5 a 90 dias até a conta ficar pronta) e os seus números de cada fase (curtidas, follows, vídeos, reels, stories, buscas, perfis).',
      'As 5 fases seguem a mesma ordem da meta recomendada e se ajustam ao prazo escolhido. A meta recomendada continua igual.',
      'Em cada conta (Ajustes desta conta → Meta) você escolhe a recomendada ou um dos seus modelos. A Jornada, o calendário e o checklist seguem o prazo da meta.',
      'O editor mostra o recomendado ao lado de cada número e avisa o que foge dele (amarelo: atenção, vermelho: risco). É por sua conta e risco.',
      'Continuam valendo: teto de 120% por dia, parada na hora em captcha ou bloqueio e pausa dos follows quando o TikTok não grava.',
    ],
  },
  {
    versao: '2.1.3',
    data: '2026-10-10',
    titulo: 'Atualizações em teste antes de chegar aos outros computadores',
    itens: [
      'Canal de teste: as versões novas chegam primeiro só no computador que testa (ícone perto do relógio → "Receber atualizações em teste"). Os outros computadores só recebem quando a versão é liberada.',
      'Nova aba "O que há de novo?" com tudo o que mudou em cada versão.',
      'A versão que está rodando aparece embaixo, à esquerda, com "(teste)" quando é uma versão em teste.',
    ],
  },
  {
    versao: '2.1.2',
    data: '2026-10-10',
    titulo: 'O app se conserta sozinho',
    itens: [
      'Se a instalação ficar incompleta (atualização interrompida num computador lento), o app percebe ao abrir, baixa a versão certa e se reinstala sozinho.',
      'Aberto no meio de uma instalação, ele não abre por cima: espera o instalador terminar.',
      'Aviso antes de atualizar: "leva alguns minutos e ele abre sozinho no fim".',
      'Mais leve: a tela ao vivo das sessões só é transmitida enquanto você olha, e a janela fechada libera memória.',
    ],
  },
  {
    versao: '2.1.1',
    data: '2026-10-10',
    titulo: 'Captcha: a janela fica aberta até você resolver',
    itens: [
      'A janela da conta nunca fecha sozinha num captcha: o robô espera você o tempo que for e continua sozinho depois.',
      'Faixa no topo do painel "Captcha em @conta" com o botão "Mostrar a janela".',
      'Enquanto um captcha espera você, as outras contas continuam aquecendo.',
    ],
  },
  {
    versao: '2.1.0',
    data: '2026-10-10',
    titulo: 'Captcha com a janela na tela e follow do TikTok conferido',
    itens: [
      'Num captcha, o robô para de mexer em tudo e mostra a janela da conta na tela para você resolver.',
      'TikTok: o follow só conta se o botão mudou; se o TikTok estiver descartando os follows da conta, o painel avisa e os follows dela pausam por 3 dias.',
    ],
  },
  {
    versao: '2.0.9',
    data: '2026-10-10',
    titulo: 'Instagram para na meta e Rotina no horário do seu computador',
    itens: [
      'Instagram: a sessão termina na hora em que a meta fecha, sem reel ou story a mais.',
      'Rotina: o app aprende em que horário cada computador costuma ficar ligado e marca as sessões dentro dele.',
    ],
  },
  {
    versao: '2.0.8',
    data: '2026-10-07',
    titulo: 'Instagram: seguir funcionando',
    itens: ['O botão "Seguir" da publicação aberta no Explorar passou a ser achado de verdade (conferido no site).'],
  },
  {
    versao: '2.0.7',
    data: '2026-10-07',
    titulo: 'Instagram: reels e curtidas conferidos no site',
    itens: [
      'Os reels trocam de verdade (antes o mesmo reel podia contar várias vezes).',
      'Curtida sempre no coração, e só conta se o coração ficou curtido.',
    ],
  },
  {
    versao: '2.0.6',
    data: '2026-10-07',
    titulo: 'Versão à vista',
    itens: ['A versão do app aparece embaixo, à esquerda, no painel.'],
  },
  {
    versao: '2.0.5',
    data: '2026-10-07',
    titulo: 'Instagram conferido no site e proxy sem vazamento',
    itens: [
      'Instagram: stories pela foto de quem postou, legenda certa para o nicho, janelas fecham no X.',
      'Proxy: o IP real não escapa mais pelo navegador, o fuso segue o país do proxy e SOCKS5 com senha é recusado no cadastro.',
    ],
  },
  {
    versao: '2.0.4',
    data: '2026-10-07',
    titulo: 'Atualização confiável',
    itens: [
      'Instalador em português, com atalhos na Área de Trabalho e no Menu Iniciar.',
      'Atualiza sozinho com a janela fechada e volta já logado; o login do aparelho não cai mais depois de trocar a senha.',
    ],
  },
  {
    versao: '2.0.3',
    data: '2026-10-07',
    titulo: 'Guia "Como usar"',
    itens: ['Guia dentro do app explicando cada tela.'],
  },
  {
    versao: '2.0.0',
    data: '2026-10-07',
    titulo: 'Aplicativo do Windows',
    itens: [
      'O WarmUp Studio virou um aplicativo do Windows, com ícone perto do relógio, notificações e atualização automática.',
      'Vários computadores ao mesmo tempo, cada um com as próprias contas; logins das contas guardados cifrados.',
    ],
  },
];
