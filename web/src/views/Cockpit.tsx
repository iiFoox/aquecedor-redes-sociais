// Cockpit: instrumentos, agenda do dia, cards das contas, feed ao vivo e alertas.
import { useEffect, useState } from 'react';
import type { Account, Config, Meta } from '../api.ts';
import { AccountActions, AttentionBox, GoalChips, Journey, Ring, StatePill, Strip } from '../components/bits.tsx';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import {
  agendaRange,
  eventClass,
  eventText,
  healthLabel,
  hhmm,
  minOfDay,
  missing,
  nextSessionAt,
  pct,
  plural,
  resultClass,
  SCHEDULE_LABEL,
  streak,
  when,
  windowSegments,
} from '../lib/format.ts';
import { useStore } from '../store.tsx';

// Relógio que atualiza a cada 30 s (agenda e "há X min")
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const winOf = (a: Account, c: Config) => a.window || { start: c.start, end: c.end };

function Instruments({ now }: { now: number }) {
  const { accounts, config, go } = useStore();
  if (!config) return null;
  const running = accounts.filter((a) => a.live);
  const avg = accounts.length ? accounts.reduce((s, a) => s + a.completion, 0) / accounts.length : 0;
  const complete = accounts.filter((a) => a.dayStatus === 'done').length;
  const waiting = accounts.filter((a) => a.attention);
  const vacation = config.pausedUntil && config.pausedUntil > now;
  const next = accounts
    .map((a) => ({ a, at: nextSessionAt(a, now) }))
    .filter((x): x is { a: Account; at: number } => x.at !== null)
    .sort((x, y) => x.at - y.at)[0];
  return (
    <div className="instruments">
      <div className="inst">
        <div className="eyebrow">Aquecendo agora</div>
        <div className="big">
          {running.length} <small>de {config.max} vagas</small>
        </div>
        <div className="sub">
          {running.length
            ? running.map((a) => `@${a.username} há ${Math.max(0, Math.round((now - a.live!.startedAt) / 60000))} min`).join(' · ')
            : 'nenhuma conta rodando'}
        </div>
      </div>
      <div className="inst">
        <div className="eyebrow">Metas de hoje</div>
        <div className="big">{pct(avg)}%</div>
        <div className={`bar ${avg >= 1 ? 'ok' : ''}`}>
          <i style={{ width: `${pct(Math.min(1, avg))}%` }} />
        </div>
        <div className="sub">{complete ? `${complete} de ${accounts.length} contas completas` : 'nenhuma conta completa ainda'}</div>
      </div>
      <div className={`inst ${waiting.length ? 'attention' : ''}`}>
        <div className="eyebrow">Esperando você</div>
        <div className="big">{waiting.length}</div>
        <div className="sub">
          {waiting.length ? `@${waiting[0].username}: ${waiting[0].attention!.msg.split('.')[0]}` : 'tudo tranquilo'}
        </div>
        {waiting.length > 0 && (
          <button className="link" onClick={() => go('conta', waiting[0].id)}>
            Resolver <Icon name="arrow" />
          </button>
        )}
      </div>
      <div className="inst">
        <div className="eyebrow">Próxima sessão</div>
        <div className="big">{vacation || !config.active || !next ? '—' : next.at <= now ? 'agora' : hhmm(next.at)}</div>
        <div className="sub">
          {vacation
            ? 'modo férias ligado'
            : !config.active
              ? 'piloto automático desligado'
              : next
                ? `@${next.a.username} · ${missing(next.a.plan, next.a.today)}`
                : 'nenhuma conta com sessão pendente'}
        </div>
      </div>
    </div>
  );
}

function Agenda({ now }: { now: number }) {
  const { accounts, config, go } = useStore();
  if (!config) return null;
  const [A0, A1] = agendaRange(accounts.map((a) => winOf(a, config)));
  const X = (m: number) => ((Math.max(A0, Math.min(A1, m)) - A0) / (A1 - A0)) * 100;
  const nowMin = minOfDay(new Date(now));
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const m = (ms: number) => Math.max(0, (ms - dayStart) / 60000);
  const ticks = [];
  for (let h = A0 / 60; h <= A1 / 60; h += A1 - A0 > 1080 ? 3 : 2) ticks.push(h);
  return (
    <div className="ag-grid">
      {accounts.map((a) => {
        const w = winOf(a, config);
        const next = nextSessionAt(a, now);
        return [
          <button key={`l${a.id}`} className="ag-label link" onClick={() => go('conta', a.id)}>
            <PlatformBadge platform={a.platform} size="xs" />
            <span>@{a.username}</span>
          </button>,
          <div key={`t${a.id}`} className="ag-track">
            {windowSegments(w.start, w.end).map(([s, e]) => (
              <span
                key={s}
                className="ag-win"
                style={{ left: `${X(s)}%`, width: `${X(e) - X(s)}%` }}
                title={`janela ${w.start}–${w.end}`}
              />
            ))}
            {a.todaySessions.map((s) => (
              <span
                key={s.start}
                className={`ag-blk ${resultClass(s.result)}`}
                style={{ left: `${X(m(s.start))}%`, width: `${Math.max(0.4, X(m(s.end)) - X(m(s.start)))}%` }}
                title={`${hhmm(s.start)}–${hhmm(s.end)}`}
              />
            ))}
            {a.live && (
              <span
                className="ag-blk running"
                style={{ left: `${X(m(a.live.startedAt))}%`, width: `${Math.max(0.4, X(nowMin) - X(m(a.live.startedAt)))}%` }}
                title={`${hhmm(a.live.startedAt)}–agora`}
              />
            )}
            {!a.live && next !== null && config.active && (
              <span
                className="ag-blk planned"
                style={{ left: `${X(m(next))}%`, width: `${Math.max(1, X(m(next) + (a.plan.minutes || 15)) - X(m(next)))}%` }}
                title={`${hhmm(next)} · próxima sessão prevista`}
              />
            )}
          </div>,
        ];
      })}
      <div />
      <div className="ag-axis">
        {ticks.map((h) => (
          <span key={h} style={{ left: `${X(h * 60)}%` }}>
            {String(h).padStart(2, '0')}h
          </span>
        ))}
      </div>
      {nowMin >= A0 && (
        <div className="ag-now" style={{ ['--x' as string]: X(nowMin) }}>
          <span>{hhmm(now)}</span>
        </div>
      )}
    </div>
  );
}

export function AccountCard({ a, meta, now }: { a: Account; meta: Meta; now: number }) {
  const { go, flash, config } = useStore();
  const hit = a.dayStatus === 'done';
  const s = streak(a.days);
  const sub = a.day >= meta.readyDay ? `Dia ${a.day} · aquecida` : `Dia ${a.day} de ${meta.readyDay}`;
  const miss = missing(a.plan, a.today);
  const why = !a.live && !a.loginOpen && !a.attention && config?.active ? SCHEDULE_LABEL[a.schedule] : null;
  return (
    <article className={`card ${hit ? 'goal-hit' : ''} ${flash === a.id ? 'flash' : ''}`}>
      <div className="card-head">
        <PlatformBadge platform={a.platform} />
        <div className="min0">
          <button className="handle-btn" onClick={() => go('conta', a.id)}>
            @{a.username}
          </button>
          <div className="sub">
            {meta.platforms[a.platform].name} · {sub}
          </div>
        </div>
        <StatePill a={a} />
      </div>
      <Journey a={a} meta={meta} />
      <div className="goals">
        <div className="g-top">
          <span>Meta de hoje{miss.length <= 28 ? ` · ${miss}` : ''}</span>
          <b className="mono">{pct(a.completion)}%</b>
        </div>
        <div className={`bar ${hit ? 'ok' : ''}`}>
          <i style={{ width: `${pct(Math.min(1, a.completion))}%` }} />
        </div>
        <GoalChips a={a} />
      </div>
      {a.live && (
        <div className="live-line">
          <span className="pulse" />
          <div>
            <b>Ao vivo há {Math.max(0, Math.round((now - a.live.startedAt) / 60000))} min</b>
            <span>{a.live.status}</span>
          </div>
        </div>
      )}
      <AttentionBox a={a} />
      {why && a.schedule !== 'meta-batida' && (
        <div className="wait-line">
          <Icon name="calendar" />
          {why}
          {a.schedule === 'intervalo' && a.nextAfter ? ` · volta às ${hhmm(a.nextAfter)}` : ''}
          {a.schedule === 'fora-da-janela' && a.window ? ` · horário dela ${a.window.start}–${a.window.end}` : ''}
        </div>
      )}
      <div className="strip-wrap">
        <div className="strip-head">
          <span>Últimos 30 dias</span>
          <span>{s === 1 ? '1 dia ativo' : `${s} dias seguidos`}</span>
        </div>
        <Strip a={a} />
      </div>
      <div className="card-foot">
        <div className="health">
          <Ring score={a.health.score} />
          <span>
            Saúde
            <br />
            <b>{a.health.nodata ? 'Sem dados' : healthLabel(a.health.score)}</b>
          </span>
        </div>
        <AccountActions a={a} withOpen={!!a.live} />
      </div>
    </article>
  );
}

function Feed() {
  const { feed, meta, accounts, go } = useStore();
  if (!meta) return null;
  const actionsOf = (p?: string) => (p && meta.platforms[p as 'tiktok'] ? meta.platforms[p as 'tiktok'].actions : {});
  const items = feed.slice(0, 40);
  if (!items.length) return <p className="empty-small">Nada ainda hoje.</p>;
  return (
    <div className="feed">
      {items.map((ev, i) => {
        const acc = accounts.find((a) => a.id === ev.id);
        return (
          <div key={`${ev.t}-${i}`} className="fi">
            <time>{when(ev.t)}</time>
            <span className={`k ${eventClass(ev)}`} />
            <div>
              {acc && (
                <button className="who" onClick={() => go('conta', acc.id)}>
                  @{acc.username}
                </button>
              )}{' '}
              {eventText(ev, actionsOf(ev.platform || acc?.platform))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AlertItem({ a, x, showAccount = true }: { a: Account; x: Account['alerts'][number]; showAccount?: boolean }) {
  const { go } = useStore();
  const bad = x.level === 'danger';
  const open = !x.resolved && a.attention && a.attention.kind === x.kind;
  return (
    <div className={`alert-item ${bad ? 'bad' : ''} ${x.resolved ? 'resolved' : ''}`}>
      <div className="ai-top">
        <span className={`sev ${bad ? 'bad' : ''}`} />
        <b>
          {showAccount
            ? `@${a.username}`
            : x.kind === 'login'
              ? 'Login'
              : x.kind === 'captcha'
                ? 'Captcha'
                : x.kind === 'block'
                  ? 'Bloqueio'
                  : 'Aviso'}
        </b>
        {x.count > 1 && <span className="g-chip">{x.count}×</span>}
        <span className="mono">{when(x.lastT || x.t)}</span>
      </div>
      <div className="muted">{x.msg}</div>
      {open && a.lastScreen && (
        <a className="shot" href={`/api/accounts/${a.id}/screens/${a.lastScreen}`} target="_blank" rel="noopener">
          <img className="shot-thumb" src={`/api/accounts/${a.id}/screens/${a.lastScreen}`} alt="Print da tela" loading="lazy" />
          <span>Print da tela no momento do problema</span>
        </a>
      )}
      {x.resolved && (
        <span className="resolved-note">
          <Icon name="check" />
          resolvido
        </span>
      )}
      {open && <AccountActions a={a} />}
      {!open && showAccount && (
        <div className="actions">
          <button className="btn sm ghost" onClick={() => go('conta', a.id)}>
            Abrir conta
          </button>
        </div>
      )}
    </div>
  );
}

function Alerts() {
  const { accounts } = useStore();
  const items = accounts
    .flatMap((a) => a.alerts.map((x) => ({ a, x })))
    .sort((p, q) => Number(p.x.resolved) - Number(q.x.resolved) || q.x.lastT - p.x.lastT)
    .slice(0, 8);
  if (!items.length) return <p className="empty-small">Nenhum alerta. Tudo tranquilo.</p>;
  return (
    <div className="alerts">
      {items.map(({ a, x }) => (
        <AlertItem key={`${a.id}-${x.t}`} a={a} x={x} />
      ))}
    </div>
  );
}

export function Cockpit() {
  const { accounts, meta, config } = useStore();
  const now = useNow();
  if (!meta || !config) return null;
  const openAlerts = accounts.reduce((s, a) => s + a.alerts.filter((x) => !x.resolved).length, 0);
  return (
    <>
      <Instruments now={now} />
      <section className="panel">
        <div className="panel-head">
          <h2>Agenda de hoje</h2>
          <div className="legend-row">
            <span>
              <i style={{ background: 'color-mix(in srgb, var(--b3) 30%, var(--heat0))' }} />
              janela permitida
            </span>
            <span>
              <i style={{ background: 'var(--ok)' }} />
              concluída
            </span>
            <span>
              <i style={{ background: 'var(--dim)' }} />
              interrompida
            </span>
            <span>
              <i style={{ background: 'var(--warn)' }} />
              sem login
            </span>
            <span>
              <i style={{ background: 'var(--bad)' }} />
              problema
            </span>
            <span>
              <i style={{ border: '1.5px dashed var(--b2)' }} />
              prevista
            </span>
          </div>
        </div>
        <div className="agenda-scroll">
          <Agenda now={now} />
        </div>
      </section>
      <div className="section-head">
        <h2>Contas</h2>
        <span className="muted">{plural(accounts.length, 'conta', 'contas')}</span>
      </div>
      <div className="cards">
        {accounts.map((a) => (
          <AccountCard key={a.id} a={a} meta={meta} now={now} />
        ))}
      </div>
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h2>Ao vivo</h2>
            <span className="muted">o que o motor fez, em todas as contas</span>
          </div>
          <Feed />
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Alertas</h2>
            <span className="muted">{openAlerts ? plural(openAlerts, 'aberto', 'abertos') : 'nenhum aberto'}</span>
          </div>
          <Alerts />
        </section>
      </div>
    </>
  );
}
