// Card "Naturalidade": a personalidade da conta e como foram os tempos da última sessão
// (pausas e tempo por vídeo). Pessoas reais têm muitas pausas curtas e algumas bem longas.
import type { AccountFull, Persona, Timing } from '../api.ts';
import { resultLabel, ddmm, hhmm } from '../lib/format.ts';

const fmt = (ms: number) =>
  ms >= 60000 ? `${(ms / 60000).toFixed(1).replace('.', ',')} min` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace('.', ',')} s`;
const pct = (v: number) => `${v > 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;

// Histograma em barras: uma por faixa de tempo
function Histogram({ t, title, aria }: { t: Timing; title: string; aria: string }) {
  const top = Math.max(1, ...t.hist);
  const labels = t.edges
    .map((e, i) => (i === 0 ? `<${fmt(e)}` : `${fmt(t.edges[i - 1])}–${fmt(e)}`))
    .concat([`>${fmt(t.edges[t.edges.length - 1])}`]);
  // Só as faixas entre a primeira e a última que tiveram algo
  const first = t.hist.findIndex((n) => n > 0);
  const last = t.hist.length - 1 - [...t.hist].reverse().findIndex((n) => n > 0);
  const rows = t.hist.map((n, i) => ({ n, label: labels[i] })).slice(first, last + 1);
  return (
    <div className="nat-hist" role="img" aria-label={aria}>
      <div className="g-top">
        <span>{title}</span>
        <span className="mono">
          {t.n} · mediana {fmt(t.p50)} · 90% até {fmt(t.p90)} · maior {fmt(t.max)}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="nat-row">
          <span className="mono dim">{r.label}</span>
          <div className="bar">
            <i style={{ width: `${(r.n / top) * 100}%` }} />
          </div>
          <span className="mono">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

function Traits({ p }: { p: Persona }) {
  const items: [string, string, string][] = [
    [
      'Leitura',
      p.readSpeed > 1 ? `${pct(p.readSpeed)} mais devagar` : `${pct(p.readSpeed).replace('-', '')} mais rápida`,
      'tempo lendo legendas e posts',
    ],
    ['Ritmo', p.pace > 1 ? `${pct(p.pace)} mais calmo` : `${pct(p.pace).replace('-', '')} mais ágil`, 'cliques e transições'],
    ['Paciência com vídeos', p.patience >= 1 ? 'assiste mais até o fim' : 'pula mais rápido', `${p.patience}x`],
    ['Curtir', p.likeBias >= 1 ? 'curte mais cedo no dia' : 'curte mais tarde no dia', 'o total segue o plano'],
    ['Horário preferido', `por volta das ${p.peak}h`, `espalha ±${p.spread.toString().replace('.', ',')} h`],
    [
      'Distrações',
      p.distraction >= 1.15 ? 'se distrai bastante' : p.distraction <= 0.85 ? 'se distrai pouco' : 'normal',
      `${p.distraction}x`,
    ],
    [
      'Rolagem',
      `passos de ~${p.scroll.step} px`,
      `${Math.round(p.scroll.flick * 100)}% rápidas · ${Math.round(p.scroll.overshoot * 100)}% passa do ponto`,
    ],
    ['Digitação', `${p.typingCps.toString().replace('.', ',')} letras/s`, 'na busca do TikTok, às vezes erra e apaga'],
    ['Curtir vídeo', `${Math.round((p.doubleTap ?? 0.4) * 100)}% com dois cliques`, 'o resto no coração'],
  ];
  return (
    <dl className="nat-traits">
      {items.map(([k, v, note]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            {v} <span className="dim">· {note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Naturalidade({ full }: { full: AccountFull }) {
  const last = full.history.find((h) => h.timing && (h.timing.pause || h.timing.watch));
  return (
    <section className="panel mt">
      <div className="panel-head">
        <h2>Naturalidade</h2>
        <span className="muted">o jeito desta conta e os tempos da última sessão</span>
      </div>
      <div className="nat-grid">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Personalidade (fixa da conta)
          </div>
          {full.persona ? <Traits p={full.persona} /> : <p className="empty-small">Sorteada quando o motor abrir de novo.</p>}
        </div>
        <div className="stack">
          {last && last.timing ? (
            <>
              <div className="eyebrow">
                Sessão de {ddmm(last.date.slice(0, 10))} às {hhmm(Date.parse(last.date))} · {resultLabel(last)}
              </div>
              {last.timing.pause && <Histogram t={last.timing.pause} title="Pausas" aria="Distribuição das pausas da última sessão" />}
              {last.timing.watch && (
                <Histogram t={last.timing.watch} title="Tempo por vídeo" aria="Distribuição do tempo por vídeo da última sessão" />
              )}
              <p className="help">
                Gente de verdade: muitas pausas curtas e algumas bem longas; vídeos pulados, vistos pela metade e inteiros.
              </p>
            </>
          ) : (
            <p className="empty-small">Os tempos aparecem aqui depois da primeira sessão com o comportamento novo.</p>
          )}
        </div>
      </div>
    </section>
  );
}
