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
// Fases para outro dia de "pronta" (meta personalizada): as 5 fases na mesma ordem, esticadas ou encurtadas na mesma
// proporção das recomendadas (fim das fases 1 a 4 nos dias 3, 7, 14 e 21 de 21). Cada fase tem pelo menos 1 dia.
const ENDS = [3, 7, 14, 21];
function phasesFor(readyDay = READY_DAY) {
  if (!readyDay || readyDay === READY_DAY) return PHASES;
  const span = Math.max(4, readyDay - 1);
  const ends = [];
  ENDS.forEach((e, i) => ends.push(Math.min(span - (3 - i), Math.max((ends[i - 1] || 0) + 1, Math.round((e / 21) * span)))));
  ends[3] = span;
  return PHASES.map((p, i) => ({ ...p, from: i ? ends[i - 1] + 1 : 1, to: i < 4 ? ends[i] : 9999 }));
}
const phaseFor = (day, readyDay = READY_DAY) => {
  const list = phasesFor(readyDay);
  return list.find((p) => day >= p.from && day <= p.to) || list[list.length - 1];
};
const phaseIndex = (day, readyDay = READY_DAY) => phasesFor(readyDay).findIndex((p) => p.n === phaseFor(day, readyDay).n);

module.exports = { PHASES, READY_DAY, CHECKLIST, phasesFor, phaseFor, phaseIndex };
