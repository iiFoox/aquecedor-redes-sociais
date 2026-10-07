const PHASES = [
  {
    n: 1,
    name: 'Adaptação',
    from: 1,
    to: 3,
    desc: 'Só consumo: rolar o feed, ver stories e vídeos. Nenhum follow. Cria histórico de uso e mostra ao algoritmo que há um humano real.',
  },
  {
    n: 2,
    name: 'Interação leve',
    from: 4,
    to: 7,
    desc: 'Primeiras curtidas e poucos follows dentro do nicho, sempre espaçados e com baixa frequência.',
  },
  {
    n: 3,
    name: 'Engajamento',
    from: 8,
    to: 14,
    desc: 'Mais curtidas, follows e exploração de hashtags e buscas do nicho. A conta ganha um perfil de interesses claro.',
  },
  {
    n: 4,
    name: 'Consolidação',
    from: 15,
    to: 21,
    desc: 'Volume parecido com o de um usuário ativo comum, com sessões mais longas e uso diário consistente.',
  },
  {
    n: 5,
    name: 'Aquecida',
    from: 22,
    to: 9999,
    desc: 'Conta pronta para postar e crescer. Uma sessão diária de manutenção preserva a confiança da plataforma.',
  },
];

const READY_DAY = 22;

// Checklist "conta pronta": o que fazer no perfil antes de começar a postar (libera no dia 22)
const CHECKLIST = [
  { key: 'foto', label: 'Foto de perfil' },
  { key: 'bio', label: 'Bio com o nicho e uma chamada' },
  { key: 'link', label: 'Link na bio' },
  { key: 'posts', label: '3 primeiros posts' },
  { key: 'destaques', label: '2 destaques fixos (ou vídeos fixados no TikTok)' },
];
const phaseFor = (day) => PHASES.find((p) => day >= p.from && day <= p.to) || PHASES[PHASES.length - 1];
const phaseIndex = (day) => PHASES.indexOf(phaseFor(day));

module.exports = { PHASES, READY_DAY, CHECKLIST, phaseFor, phaseIndex };
