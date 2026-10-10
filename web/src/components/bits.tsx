// Peças pequenas usadas em várias telas.
import type { Account, Meta } from '../api.ts';
import { addDays, ddmm, goalKeys, healthColor, heat, pct } from '../lib/format.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';

export function Ring({ score, size = 40, label = true }: { score: number; size?: number; label?: boolean }) {
  const r = 15.9155;
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-label={`Saúde ${score} de 100`}>
      <circle cx="18" cy="18" r={r} fill="none" style={{ stroke: 'var(--heat0)' }} strokeWidth="3.4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        style={{ stroke: healthColor(score) }}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeDasharray={`${score} 100`}
        transform="rotate(-90 18 18)"
      />
      {label && (
        <text x="18" y="21.6" textAnchor="middle" style={{ fill: 'var(--fg)', font: '600 10px var(--font)' }}>
          {score}
        </text>
      )}
    </svg>
  );
}

// Gráfico de barras em SVG (sem biblioteca)
export function BarChart({
  vals,
  labels,
  max = 1,
  ticks = [0, 0.5, 1],
  fmt = (v: number) => `${pct(v)}%`,
  fullAt = 1 as number | null,
  aria,
}: {
  vals: (number | null)[];
  labels: string[];
  max?: number;
  ticks?: number[];
  fmt?: (v: number) => string;
  fullAt?: number | null;
  aria: string;
}) {
  const W = 640;
  const H = 190;
  const L = 50;
  const R = 10;
  const T = 10;
  const B = 24;
  const n = vals.length;
  const cw = (W - L - R) / n;
  const bw = Math.max(3, cw * 0.62);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      {ticks.map((tv) => (
        <g key={tv}>
          <line className="gl" x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} />
          <text x={L - 7} y={y(tv) + 3.5} textAnchor="end">
            {fmt(tv)}
          </text>
        </g>
      ))}
      {vals.map((v, i) => {
        if (v == null) return null;
        const x = L + i * cw + (cw - bw) / 2;
        const top = v === 0 ? H - B - 3 : y(Math.min(v, max));
        const cls = v === 0 ? 'b0' : fullAt != null && v >= fullAt ? 'b1' : 'b';
        return (
          <rect key={i} className={cls} x={x} y={top} width={bw} height={Math.max(3, H - B - top)} rx="2">
            <title>{`${labels[i]} · ${fmt(v)}`}</title>
          </rect>
        );
      })}
      {labels.map((lb, i) =>
        i % 5 === 4 || i === n - 1 ? (
          <text key={lb + i} x={L + i * cw + cw / 2} y={H - 6} textAnchor="middle">
            {lb}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// Jornada: um trecho por fase e a bandeira do dia em que a conta fica pronta (22, ou o prazo da meta personalizada)
export function Journey({ a }: { a: Account; meta?: Meta }) {
  const ready = a.day >= a.readyDay;
  const left = a.readyDay - a.day;
  const today = a.days[a.days.length - 1].date;
  const readyDate = addDays(today, left);
  return (
    <div className="journey">
      <div className="j-track">
        {a.phases.slice(0, 4).map((p) => {
          const len = p.to - p.from + 1;
          const f = Math.max(0, Math.min(1, (a.day - p.from + 1) / len));
          return (
            <span
              key={p.n}
              className={`j-seg ${a.day >= p.from && a.day <= p.to ? 'cur' : ''}`}
              style={{ flex: len }}
              title={`Fase ${p.n} · ${p.name} (dias ${p.from} a ${p.to})`}
            >
              <i style={{ width: `${f * 100}%` }} />
            </span>
          );
        })}
        <span className={`j-flag ${ready ? 'done' : ''}`} title={`Dia ${a.readyDay}: pronta`}>
          {ready ? <Icon name="check" /> : a.readyDay}
        </span>
      </div>
      <div className="j-meta">
        <span>
          <b>Fase {a.phase.n}</b> · {a.phase.name}
        </span>
        <span>{ready ? 'pronta para postar' : `pronta em ${left} ${left === 1 ? 'dia' : 'dias'}, ${ddmm(readyDate)}`}</span>
      </div>
    </div>
  );
}

// Faixa dos últimos 30 dias (um quadradinho por dia)
export function Strip({ a }: { a: Account }) {
  const days = a.days.slice(-30);
  return (
    <div className="strip">
      {days.map((d, i) => (
        <span
          key={d.date}
          className={`${d.vacation ? 'none' : heat(d.completion)} ${i === days.length - 1 ? 'today' : ''}`}
          title={`${ddmm(d.date)} · ${d.vacation ? 'férias' : d.completion == null ? 'sem aquecimento' : `${pct(d.completion)}% da meta`}`}
        />
      ))}
    </div>
  );
}

export function StatePill({ a }: { a: Account }) {
  const { meta, config } = useStore();
  const vacation = config?.pausedUntil && config.pausedUntil > Date.now();
  if (a.live)
    return (
      <span className="pill running">
        <span className="pulse" />
        Aquecendo
      </span>
    );
  if (a.loginOpen) return <span className="pill login">{a.browserPurpose === 'captcha' ? 'Navegador aberto' : 'Aguardando login'}</span>;
  if (a.attention)
    return (
      <span className={`pill ${a.attention.kind === 'login' ? 'login' : 'paused'}`}>
        <Icon name={a.attention.kind === 'login' ? 'key' : 'pause'} />
        {a.attention.kind === 'login' ? 'Precisa de login' : a.attention.kind === 'captcha' ? 'Captcha' : 'Bloqueada'}
      </span>
    );
  if (vacation)
    return (
      <span className="pill">
        <Icon name="pause" />
        Férias
      </span>
    );
  if (a.dayStatus === 'done')
    return (
      <span className="pill hit">
        <Icon name="check" />
        Meta batida
      </span>
    );
  if (a.dayStatus === 'limit') return <span className="pill">Limite do plano</span>;
  if (meta && a.day >= a.readyDay) return <span className="pill ready">Pronta</span>;
  return <span className="pill">Parada</span>;
}

export function GoalChips({ a }: { a: Account }) {
  const { meta } = useStore();
  if (!meta) return null;
  const labels = meta.platforms[a.platform].actions;
  return (
    <div className="g-chips">
      {goalKeys(a.plan, a.today, Object.keys(labels)).map((k) => {
        const d = a.today[k] || 0;
        const p = a.plan[k] || 0;
        return (
          <span key={k} className={`g-chip ${p > 0 && d >= p ? 'done' : ''}`}>
            {labels[k]} <b>{p > 0 ? `${d}/${p}` : d}</b>
          </span>
        );
      })}
    </div>
  );
}

const ATTENTION_TITLE = { login: 'Precisa de login', captcha: 'Precisa resolver o captcha', block: 'Bloqueada até você liberar' };

export function AttentionBox({ a }: { a: Account }) {
  if (!a.attention) return null;
  return (
    <div className={`attention-box ${a.attention.kind}`}>
      <b>{ATTENTION_TITLE[a.attention.kind]}</b>
      <span>{a.attention.msg}</span>
    </div>
  );
}

// Botões da conta, conforme a situação (sessão rodando, aviso pendente, navegador aberto ou parada)
export function AccountActions({ a, big = false, withOpen = false }: { a: Account; big?: boolean; withOpen?: boolean }) {
  const { act, go } = useStore();
  const sm = big ? '' : 'sm';
  const open = withOpen ? (
    <button className={`btn ${sm}`} onClick={() => go('conta', a.id)}>
      <Icon name="eye" />
      {a.live ? 'Ao vivo' : 'Abrir'}
    </button>
  ) : null;
  if (a.live)
    return (
      <div className="actions">
        {open}
        <button className={`btn ${sm}`} onClick={() => act.stop(a)}>
          <Icon name="stop" />
          Parar
        </button>
      </div>
    );
  if (a.loginOpen)
    return (
      <div className="actions">
        {open}
        <button className={`btn ${sm}`} onClick={() => act.closeBrowser(a)}>
          <Icon name="x" />
          Fechar navegador
        </button>
      </div>
    );
  if (a.attention?.kind === 'captcha')
    return (
      <div className="actions">
        <button className={`btn ${sm} warn`} onClick={() => act.captcha(a)}>
          <Icon name="window" />
          Abrir navegador
        </button>
        <button className={`btn ${sm} ghost`} onClick={() => act.release(a)}>
          Liberar
        </button>
      </div>
    );
  if (a.attention?.kind === 'block')
    return (
      <div className="actions">
        <button className={`btn ${sm} warn`} onClick={() => act.release(a)}>
          Liberar
        </button>
        {open}
      </div>
    );
  if (a.attention?.kind === 'login')
    return (
      <div className="actions">
        <button className={`btn ${sm} warn`} onClick={() => act.login(a)}>
          <Icon name="key" />
          Login
        </button>
        {open}
      </div>
    );
  return (
    <div className="actions">
      <button className={`btn ${sm} primary`} onClick={() => act.start(a)}>
        <Icon name="play" />
        Iniciar
      </button>
      <button className={`btn ${sm}`} onClick={() => act.login(a)}>
        <Icon name="key" />
        Login
      </button>
    </div>
  );
}
