// Metas personalizadas no painel: as fases para outro prazo (igual a motor/platforms/phases.js, conferido em teste)
// e os avisos do editor (acima do recomendado, prazo curto, fora da ordem). Funções puras, testadas.
import type { Phase } from '../api.ts';

export const READY_DAY = 22;
const ENDS = [3, 7, 14, 21];

// Dias de cada fase para o prazo "readyDay": as 5 fases na mesma ordem, na mesma proporção das recomendadas
export function phasesFor(base: Phase[], readyDay: number): Phase[] {
  if (!readyDay || readyDay === READY_DAY) return base;
  const span = Math.max(4, readyDay - 1);
  const ends: number[] = [];
  ENDS.forEach((e, i) => ends.push(Math.min(span - (3 - i), Math.max((ends[i - 1] || 0) + 1, Math.round((e / 21) * span)))));
  ends[3] = span;
  return base.map((p, i) => ({ ...p, from: i ? ends[i - 1] + 1 : 1, to: i < 4 ? ends[i] : 9999 }));
}

export type Nivel = 'atencao' | 'risco';
export interface Aviso {
  fase: number | null; // 1..5, ou null (o modelo todo)
  key: string | null;
  nivel: Nivel;
  msg: string;
}

/**
 * Avisos de um modelo comparado com a meta recomendada da plataforma (plans: 5 fases). Não bloqueiam nada:
 * a meta personalizada é por conta e risco do dono. labels: nome de cada meta ("Curtidas").
 */
export function avisos(
  platform: 'tiktok' | 'instagram',
  t: { readyDay: number; phases: Record<string, number>[] },
  plans: Record<string, number>[],
  labels: Record<string, string>,
): Aviso[] {
  const out: Aviso[] = [];
  const name = (k: string) => labels[k] || k;
  if (t.readyDay < 10)
    out.push({ fase: null, key: null, nivel: 'risco', msg: `Prazo muito curto: pronta em ${t.readyDay} dias (recomendado ${READY_DAY}).` });
  else if (t.readyDay < 15)
    out.push({ fase: null, key: null, nivel: 'atencao', msg: `Prazo curto: pronta em ${t.readyDay} dias (recomendado ${READY_DAY}).` });
  t.phases.forEach((ph, i) => {
    const n = i + 1;
    for (const k of Object.keys(plans[i] || {})) {
      if (k === 'minutes') continue;
      const v = ph[k] ?? 0;
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
    // TikTok: cada curtida é num vídeo assistido. Mais curtidas que vídeos, o dia não fecha.
    if (platform === 'tiktok' && (ph.like ?? 0) > (ph.watch ?? 0))
      out.push({
        fase: n,
        key: 'like',
        nivel: 'risco',
        msg: `Fase ${n}: mais curtidas (${ph.like}) que vídeos (${ph.watch}): o dia não fecha.`,
      });
  });
  return out;
}

// O pior aviso de um campo (para colorir a célula)
export function nivelDe(list: Aviso[], fase: number, key: string): Nivel | null {
  const mine = list.filter((a) => a.fase === fase && a.key === key);
  return mine.some((a) => a.nivel === 'risco') ? 'risco' : mine.length ? 'atencao' : null;
}
