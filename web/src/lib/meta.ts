// Metas personalizadas no painel: as fases para outro prazo (igual a motor/platforms/phases.js, conferido em teste),
// os avisos do editor, a prévia dia a dia e os pontos de partida. Funções puras, testadas (tests/web-format.test.ts).
import type { Phase } from '../api.ts';

export const READY_DAY = 22;
const ENDS = [3, 7, 14, 21];
type Nums = Record<string, number>;
export type Limits = Record<string, [number, number]>;

// Dias de cada fase para o prazo "readyDay": as 5 fases na mesma ordem, na mesma proporção das recomendadas
export function phasesFor(base: Phase[], readyDay: number): Phase[] {
  if (!readyDay || readyDay === READY_DAY) return base;
  const span = Math.max(4, readyDay - 1);
  const ends: number[] = [];
  ENDS.forEach((e, i) => ends.push(Math.min(span - (3 - i), Math.max((ends[i - 1] || 0) + 1, Math.round((e / 21) * span)))));
  ends[3] = span;
  return base.map((p, i) => ({ ...p, from: i ? ends[i - 1] + 1 : 1, to: i < 4 ? ends[i] : 9999 }));
}

// Em que fase (0 a 4) cai o dia "day" com o prazo "readyDay"
export function phaseIdx(base: Phase[], day: number, readyDay: number) {
  const list = phasesFor(base, readyDay);
  const i = list.findIndex((p) => day >= p.from && day <= p.to);
  return i < 0 ? list.length - 1 : i;
}

// erro = o motor recusa (fora do limite ou impossível de fazer): bloqueia salvar. atenção/risco: só avisam.
export type Nivel = 'atencao' | 'risco' | 'erro';
export interface Aviso {
  fase: number | null; // 1..5, ou null (o modelo todo)
  key: string | null;
  nivel: Nivel;
  msg: string;
}

// Combinações que o robô não consegue fazer: as mesmas de motor/custom.js (impossible), conferidas em teste
export function impossiveis(platform: 'tiktok' | 'instagram', ph: Nums, labels: Record<string, string>): { key: string; msg: string }[] {
  const n = (k: string) => ph[k] || 0;
  const lc = (k: string) => (labels[k] || k).toLowerCase();
  const out: { key: string; msg: string }[] = [];
  if (platform === 'tiktok') {
    if (n('like') > n('watch')) out.push({ key: 'like', msg: `mais ${lc('like')} (${n('like')}) que ${lc('watch')} (${n('watch')})` });
    if (n('follow') > n('watch') + n('profile'))
      out.push({
        key: 'follow',
        msg: `mais ${lc('follow')} (${n('follow')}) que ${lc('watch')} + ${lc('profile')} (${n('watch') + n('profile')})`,
      });
  }
  if (platform === 'instagram' && n('follow') > 0 && n('explore') === 0)
    out.push({ key: 'follow', msg: `${lc('follow')} precisam de pelo menos 1 em ${labels.explore || 'Explorar'} (é de lá que eles saem)` });
  return out;
}

/**
 * Avisos de um modelo comparado com a meta recomendada da plataforma (plans: 5 fases). "erro" bloqueia salvar (o motor
 * recusaria); atenção e risco não bloqueiam: a meta personalizada é por conta e risco do dono. labels: nome de cada meta.
 */
export function avisos(
  platform: 'tiktok' | 'instagram',
  t: { readyDay: number; phases: Nums[] },
  plans: Nums[],
  labels: Record<string, string>,
  limits: Limits = {},
): Aviso[] {
  const out: Aviso[] = [];
  const name = (k: string) => labels[k] || k;
  const rd = limits.readyDay;
  if (rd && (t.readyDay < rd[0] || t.readyDay > rd[1]))
    out.push({ fase: null, key: 'readyDay', nivel: 'erro', msg: `Dias até a conta ficar pronta: entre ${rd[0]} e ${rd[1]}.` });
  else if (t.readyDay < 10)
    out.push({ fase: null, key: null, nivel: 'risco', msg: `Prazo muito curto: pronta em ${t.readyDay} dias (recomendado ${READY_DAY}).` });
  else if (t.readyDay < 15)
    out.push({ fase: null, key: null, nivel: 'atencao', msg: `Prazo curto: pronta em ${t.readyDay} dias (recomendado ${READY_DAY}).` });
  t.phases.forEach((ph, i) => {
    const n = i + 1;
    for (const k of Object.keys(plans[i] || {})) {
      const v = ph[k] ?? 0;
      const lim = limits[k];
      if (lim && (v < lim[0] || v > lim[1])) {
        out.push({
          fase: n,
          key: k,
          nivel: 'erro',
          msg: `Fase ${n}: ${name(k)} ${v}, ${v < lim[0] ? `mínimo ${lim[0]}` : `máximo ${lim[1]}`} por dia.`,
        });
        continue;
      }
      if (k === 'minutes') continue;
      const rec = plans[i][k];
      if (rec === 0 && v > 0)
        out.push({
          fase: n,
          key: k,
          nivel: k === 'follow' || v > 3 ? 'risco' : 'atencao',
          msg: `Fase ${n}: ${v} ${name(k).toLowerCase()} onde o recomendado é nenhum.`,
        });
      else if (rec > 0 && v > rec * 3)
        out.push({ fase: n, key: k, nivel: 'risco', msg: `Fase ${n}: ${name(k)} ${v}, mais de 3x o recomendado (${rec}).` });
      else if (rec > 0 && v > rec * 1.5)
        out.push({ fase: n, key: k, nivel: 'atencao', msg: `Fase ${n}: ${name(k)} ${v}, acima do recomendado (${rec}).` });
      if (i > 0 && v < (t.phases[i - 1][k] ?? 0))
        out.push({
          fase: n,
          key: k,
          nivel: 'atencao',
          msg: `Fase ${n}: ${name(k).toLowerCase()} menor que na fase ${i} (o recomendado sobe aos poucos).`,
        });
    }
    for (const x of impossiveis(platform, ph, labels))
      out.push({ fase: n, key: x.key, nivel: 'erro', msg: `Fase ${n}: ${x.msg}: o dia nunca fecharia.` });
  });
  return out;
}

// O pior aviso de um campo (para colorir a célula)
export function nivelDe(list: Aviso[], fase: number, key: string): Nivel | null {
  const mine = list.filter((a) => a.fase === fase && a.key === key);
  return mine.some((a) => a.nivel === 'erro') ? 'erro' : mine.some((a) => a.nivel === 'risco') ? 'risco' : mine.length ? 'atencao' : null;
}

// "2 riscos, 3 atenções" (resumo perto do botão de salvar)
export function resumo(list: Aviso[]) {
  const c = (n: Nivel) => list.filter((a) => a.nivel === n).length;
  const part = (n: number, um: string, varios: string) => (n ? `${n} ${n === 1 ? um : varios}` : '');
  return [part(c('erro'), 'erro', 'erros'), part(c('risco'), 'risco', 'riscos'), part(c('atencao'), 'atenção', 'atenções')]
    .filter(Boolean)
    .join(', ');
}

// Prévia: o número de cada meta em cada dia, do dia 1 até "days" (sem a variação diária: é o máximo de cada dia)
export function serie(base: Phase[], phases: Nums[], readyDay: number, key: string, days: number) {
  return Array.from({ length: days }, (_, d) => phases[phaseIdx(base, d + 1, readyDay)][key] || 0);
}
// Total de uma meta do dia 1 até a conta ficar pronta (dia readyDay - 1)
export function total(base: Phase[], phases: Nums[], readyDay: number, key: string) {
  return serie(base, phases, readyDay, key, Math.max(1, readyDay - 1)).reduce((s, v) => s + v, 0);
}

// Pontos de partida do editor: cautelosa (30 dias, ~80% do recomendado), recomendada (22) e rápida (15, os números da
// recomendada em menos dias). Metas zeradas continuam zeradas; nenhuma vira impossível.
export interface Preset {
  key: string;
  name: string;
  readyDay: number;
  desc: string;
  phases: Nums[];
}
export function presets(plans: Nums[]): Preset[] {
  const scale = (f: number) =>
    plans.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ? Math.max(1, Math.round(v * f)) : 0])));
  return [
    { key: 'cautelosa', name: 'Cautelosa', readyDay: 30, desc: '30 dias, ~80% dos números', phases: scale(0.8) },
    { key: 'recomendada', name: 'Recomendada', readyDay: READY_DAY, desc: `${READY_DAY} dias, os números recomendados`, phases: scale(1) },
    { key: 'rapida', name: 'Rápida', readyDay: 15, desc: '15 dias, os números recomendados', phases: scale(1) },
  ];
}

// O que acontece com uma conta (no dia "day", hoje com o prazo curReady) ao passar para uma meta de prazo newReady
export function mudancaDeFase(base: Phase[], day: number, curReady: number, newReady: number) {
  const now = phaseIdx(base, day, curReady);
  const next = phaseIdx(base, day, newReady);
  const ph = phasesFor(base, newReady)[next];
  const head = `A conta está no dia ${day} (fase ${now + 1})`;
  if (next > now)
    return `${head}; com esta meta ela vai para a fase ${next + 1} · ${ph.name}. Os números sobem aos poucos: no máximo +25% por dia sobre o último dia com sessão.`;
  if (next < now) return `${head}; com esta meta ela volta para a fase ${next + 1} · ${ph.name}. Os números descem já hoje.`;
  return `${head}; com esta meta ela continua na fase ${next + 1} · ${ph.name}. O que subir vai aos poucos (no máximo +25% por dia).`;
}
