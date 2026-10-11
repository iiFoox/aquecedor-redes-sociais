// Página da conta: tela ao vivo, metas, sessões, jornada, saúde, ajustes, checklist, calendário, prints e eventos.
import { useEffect, useState } from 'react';
import { api, type Account, type AccountFull, type GoalTemplate, type Meta } from '../api.ts';
import { AccountActions, AttentionBox, BarChart, Ring, StatePill } from '../components/bits.tsx';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import { Naturalidade } from '../components/Naturalidade.tsx';
import { confetti } from '../lib/confetti.ts';
import {
  addDays,
  ddmm,
  diffDays,
  eventClass,
  eventText,
  goalKeys,
  healthColor,
  healthLabel,
  heat,
  hhmm,
  loginSaved,
  missing,
  pct,
  RESULT_LABEL,
  resultLabel,
  resultClass,
  SCHEDULE_LABEL,
  shotInfo,
  UNIT,
  weekday,
  when,
} from '../lib/format.ts';
import { useStore } from '../store.tsx';
import { mudancaDeFase, READY_DAY } from '../lib/meta.ts';
import { DeviceBar } from '../components/Aparelho.tsx';
import { useNow } from './Cockpit.tsx';

// Tela do navegador da sessão, transmitida pelo motor (quadros JPEG)
function LiveScreen({ a }: { a: Account }) {
  const [frame, setFrame] = useState<string | null>(null);
  const on = !!(a.live || a.loginOpen);
  useEffect(() => {
    setFrame(null);
    if (!on) return;
    const es = new EventSource(`/api/live/${a.id}`);
    es.onmessage = (e) => setFrame(e.data);
    return () => es.close();
  }, [a.id, on]);
  const now = useNow(1000);
  // Conta de outro aparelho: a tela ao vivo fica lá; aqui, o que o robô está fazendo
  if (on && !a.mine)
    return (
      <div className="screen">
        <div className="screen-msg">
          <Icon name="window" />
          <b>{a.live ? `Aquecendo em ${a.deviceName || 'outro aparelho'}` : 'Navegador aberto no outro aparelho'}</b>
          <span>{a.live ? a.live.status : 'A tela ao vivo aparece no aparelho dono da conta.'}</span>
        </div>
      </div>
    );
  if (on)
    return (
      <>
        <div className="screen tall">
          {frame ? (
            <img src={`data:image/jpeg;base64,${frame}`} alt="Tela do navegador da sessão" />
          ) : (
            <div className="screen-msg">Conectando a tela...</div>
          )}
          <span className="badge-live">{a.live ? 'AO VIVO' : a.browserPurpose === 'captcha' ? 'NAVEGADOR' : 'LOGIN'}</span>
          {a.live && <span className="screen-clock mono">{Math.max(0, Math.round((now - a.live.startedAt) / 60000))} min</span>}
        </div>
        {a.live && (
          <>
            <div className="now-status">
              <span className="pulse" />
              {a.live.status}
            </div>
            <div className="bar">
              {a.live.statusUntil ? (
                <i style={{ width: `${Math.min(100, ((now - a.live.statusAt) / (a.live.statusUntil - a.live.statusAt)) * 100)}%` }} />
              ) : (
                <i className="indet" />
              )}
            </div>
          </>
        )}
      </>
    );
  const last = a.todaySessions[a.todaySessions.length - 1];
  return (
    <div className="screen">
      <div className="screen-msg">
        <Icon name="eye" />
        <b>{a.attention ? 'Esperando você' : 'Sem sessão agora'}</b>
        <span>
          {last ? `Última sessão terminou às ${hhmm(last.end)}` : 'Ainda sem sessões hoje'}
          {!a.attention && SCHEDULE_LABEL[a.schedule] ? ` · ${SCHEDULE_LABEL[a.schedule].toLowerCase()}` : ''}
        </span>
      </div>
    </div>
  );
}

function Goals({ a, meta }: { a: Account; meta: Meta }) {
  const labels = meta.platforms[a.platform].actions;
  return (
    <>
      {goalKeys(a.plan, a.today, Object.keys(labels)).map((k) => {
        const d = a.today[k] || 0;
        const p = a.plan[k] || 0;
        return (
          <div key={k} className="goal-row">
            <div className="g-top">
              <span>
                {labels[k]} {p > 0 && d > p && <span className="over">{d - p} acima do plano</span>}
                {!p && <span className="over">fora do plano de hoje</span>}
              </span>
              <span>{p ? `${d} / ${p}` : d}</span>
            </div>
            {p > 0 && (
              <div className={`bar ${d >= p ? 'ok' : ''}`}>
                <i style={{ width: `${Math.min(100, (d / p) * 100)}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Calendar({ a }: { a: Account; meta?: Meta }) {
  const today = a.days[a.days.length - 1].date;
  const start = addDays(today, 1 - a.day);
  const ready = addDays(start, a.readyDay - 1);
  const end = ready > today ? ready : today;
  const first = addDays(diffDays(start, today) > 41 ? addDays(today, -41) : start, 0);
  const from = addDays(first, -weekday(first));
  const to = addDays(end, 6 - weekday(end));
  const byDate = new Map(a.days.map((d) => [d.date, d]));
  const cells = [];
  for (let i = 0, n = diffDays(from, to) + 1; i < n; i++) {
    const d = addDays(from, i);
    const idx = diffDays(start, d);
    const info = byDate.get(d);
    let cls = 'cc';
    let tip = ddmm(d);
    if (idx < 0) cls += ' out';
    else if (d > today) {
      cls += ' future';
      tip += ` · dia ${idx + 1}`;
    } else if (info?.vacation) {
      cls += ' none';
      tip += ' · férias';
    } else {
      cls += ` ${heat(info?.completion)}`;
      tip += ` · dia ${idx + 1}${info?.completion != null ? ` · ${pct(info.completion)}% da meta` : ''}`;
    }
    if (d === today) cls += ' today';
    if (d === ready) {
      cls += ' ready';
      tip += ' · pronta';
    }
    cells.push(
      <span key={d} className={cls} title={tip}>
        {+d.slice(8, 10)}
      </span>,
    );
  }
  return (
    <>
      <div className="cal-head">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>
      <div className="legend">
        <span>Menos</span>
        <span className="sw">
          <i />
          <i className="h1" />
          <i className="h2" />
          <i className="h3" />
          <i className="h4" />
        </span>
        <span>Mais</span>
        <span>·</span>
        <span className="rd" />
        <span>dia {a.readyDay}, pronta</span>
      </div>
    </>
  );
}

// Meta da conta: a recomendada ou um modelo personalizado da mesma plataforma (aba "Metas personalizadas")
function GoalPicker({ a }: { a: Account }) {
  const { act, go, ask, meta } = useStore();
  const [list, setList] = useState<GoalTemplate[]>([]);
  useEffect(() => {
    api<{ templates: GoalTemplate[] }>('/api/metas')
      .then((r) => setList(r.templates.filter((t) => t.platform === a.platform)))
      .catch(() => setList([]));
  }, [a.platform]);
  const pick = async (id: string) => {
    const t = list.find((x) => x.id === id);
    const readyDay = t ? t.readyDay : READY_DAY;
    const ok = await ask({
      title: t ? `Usar a meta "${t.name}" em @${a.username}?` : `Voltar @${a.username} para a meta recomendada?`,
      body: (
        <div className="ask-flow">
          <p>{meta ? mudancaDeFase(meta.phases, a.day, a.readyDay, readyDay) : null}</p>
          <p>O plano de hoje é refeito com a meta {t ? 'nova' : 'recomendada'}.</p>
          {a.live ? <p>A sessão que está rodando agora termina com o plano antigo; a mudança vale a partir da próxima.</p> : null}
          {t ? <p className="ask-risco">Meta personalizada é por sua conta e risco.</p> : null}
        </div>
      ),
      ok: t ? 'Usar esta meta' : 'Voltar para a recomendada',
    });
    if (ok) act.patch(a, { goalTemplate: id || null }, t ? `Meta "${t.name}" nesta conta` : 'Meta recomendada de volta');
  };
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <label htmlFor="acc-meta">Meta</label>
      <select id="acc-meta" className="input select" value={a.goal ? a.goal.id : ''} onChange={(e) => pick(e.target.value)}>
        <option value="">Recomendada (pronta no dia 22)</option>
        {list.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · personalizada, pronta no dia {t.readyDay}
          </option>
        ))}
      </select>
      <span className="help">
        {a.goal ? 'Meta personalizada: por sua conta e risco. ' : ''}
        {a.goalRamp ? `Em transição para a meta nova desde ${ddmm(a.goalRamp)}: os números sobem no máximo +25% por dia. ` : ''}
        <button type="button" className="link" onClick={() => go('metas')}>
          {list.length ? 'Ver e editar os modelos' : 'Criar uma meta personalizada'}
        </button>
      </span>
    </div>
  );
}

// Horário próprio, proxy e interesses da conta
function Settings({ a, full }: { a: Account; full: AccountFull }) {
  const { config, proxies, act, ask } = useStore();
  const [own, setOwn] = useState(!!a.window);
  const [start, setStart] = useState(a.window?.start || config?.start || '08:00');
  const [end, setEnd] = useState(a.window?.end || config?.end || '22:00');
  const [proxy, setProxy] = useState(full.proxyUrl);
  const [interests, setInterests] = useState(a.interests.join(', '));
  useEffect(() => {
    setOwn(!!a.window);
    setProxy(full.proxyUrl);
    setInterests(a.interests.join(', '));
  }, [a.id, full.proxyUrl]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { window: own ? { start, end } : null, interests };
    if (proxy !== full.proxyUrl) {
      body.proxy = proxy;
      if (
        full.proxyUrl &&
        !(await ask({
          title: 'Trocar o proxy?',
          body: 'Trocar o proxy muda o IP desta conta e pode pedir verificação.',
          ok: 'Trocar o proxy',
        }))
      )
        return;
    }
    act.patch(a, body, 'Ajustes salvos');
  };
  const online = proxies.filter((p) => p.status === 'online').length;
  return (
    <form onSubmit={save}>
      <div className="set-row">
        <div>
          <b>Horário próprio</b>
          <span>{own ? 'Fora deste horário, a conta não aquece.' : `Usa o horário geral (${config?.start}–${config?.end}).`}</span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} aria-label="Horário próprio" />
          <span />
        </label>
      </div>
      {own && (
        <div className="field-row" style={{ marginBottom: 8 }}>
          <input
            className="input sm mono"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label="Início"
            required
          />
          <span className="dim">até</span>
          <input className="input sm mono" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Fim" required />
        </div>
      )}
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="acc-proxy">Proxy</label>
        <select id="acc-proxy" className="input select" value={proxy} onChange={(e) => setProxy(e.target.value)}>
          <option value="">Sem proxy (internet de casa)</option>
          {online > 0 && <option value="auto">Automático (o online com menos contas)</option>}
          {proxies.map((p) => (
            <option key={p.id} value={p.url}>
              {new URL(p.url).host} · {p.status === 'online' ? `${p.ms} ms` : p.status === 'offline' ? 'fora do ar' : 'não testado'} ·{' '}
              {p.accounts.length} conta(s)
            </option>
          ))}
        </select>
        {proxy && proxy === full.proxyUrl && a.proxyStatus === 'offline' && (
          <span className="form-err">Este proxy falhou no último teste.</span>
        )}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="acc-int">Interesses do nicho</label>
        <input
          id="acc-int"
          className="input"
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="IA, comédia, tecnologia"
        />
        <span className="help">Separados por vírgula. O robô usa nas buscas e passa mais tempo nesses assuntos.</span>
      </div>
      <button className="btn sm primary" type="submit" style={{ marginTop: 12 }}>
        Salvar ajustes
      </button>
    </form>
  );
}

function Checklist({ a, meta }: { a: Account; meta: Meta }) {
  const { act } = useStore();
  const unlocked = a.day >= a.readyDay;
  const done = meta.checklist.filter((c) => a.checklist[c.key]).length;
  const readyDate = addDays(a.days[a.days.length - 1].date, a.readyDay - a.day);
  const toggle = async (key: string, v: boolean) => {
    await act.patch(a, { checklist: { [key]: v } });
    if (v && done + 1 === meta.checklist.length) {
      confetti();
    }
  };
  if (!unlocked)
    return (
      <>
        <div className="lock-msg">
          <Icon name="lock" />
          Libera no dia {a.readyDay} ({ddmm(readyDate)}), quando a conta fica pronta.
        </div>
        <div className="check locked">
          {meta.checklist.map((c) => (
            <label key={c.key}>
              <input type="checkbox" disabled /> {c.label}
            </label>
          ))}
        </div>
      </>
    );
  return (
    <>
      <div className="g-top" style={{ marginBottom: 10 }}>
        <span>Complete antes de começar a postar</span>
        <b className="mono">
          {done} de {meta.checklist.length}
        </b>
      </div>
      <div className="check">
        {meta.checklist.map((c) => (
          <label key={c.key}>
            <input type="checkbox" checked={!!a.checklist[c.key]} onChange={(e) => toggle(c.key, e.target.checked)} /> {c.label}
          </label>
        ))}
      </div>
    </>
  );
}

export function Conta() {
  const { accounts, accountId, meta, tick, act, go, ask } = useStore();
  const [full, setFull] = useState<AccountFull | null>(null);
  const [missingAcc, setMissingAcc] = useState(false);
  const a = accounts.find((x) => x.id === accountId);
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    api<AccountFull>(`/api/accounts/${accountId}`)
      .then((r) => alive && (setFull(r), setMissingAcc(false)))
      .catch(() => alive && setMissingAcc(true));
    return () => {
      alive = false;
    };
  }, [accountId, tick]);
  if (missingAcc && !a)
    return (
      <div className="panel empty">
        <h2>Conta não encontrada</h2>
        <button className="btn" onClick={() => go('cockpit')}>
          Voltar ao cockpit
        </button>
      </div>
    );
  if (!a || !meta || !full || full.id !== a.id) return null;
  const labels = meta.platforms[a.platform].actions;
  const h = a.health;
  const days30 = a.days.slice(-30);
  const readyLeft = a.readyDay - a.day;
  const hRow = (label: string, v: number, note: string) => (
    <div className="h-row">
      <div className="g-top">
        <span>
          {label} <span className="dim">· {note}</span>
        </span>
        <b className="mono">{v}%</b>
      </div>
      <div className="bar">
        <i style={{ width: `${v}%`, background: healthColor(v) }} />
      </div>
    </div>
  );
  return (
    <>
      <div className="d-head">
        <div className="d-id">
          <PlatformBadge platform={a.platform} />
          <div className="min0">
            <h2>@{a.username}</h2>
            <div className="meta">
              <StatePill a={a} />
              <span>
                {meta.platforms[a.platform].name} · Dia {a.day} · Fase {a.phase.n}, {a.phase.name}
              </span>
              {a.interests.length > 0 && <span>· {a.interests.join(', ')}</span>}
              {a.proxyHost && <span>· proxy {a.proxyHost}</span>}
              <span className={a.loginSavedAt ? '' : 'dim'}>· {loginSaved(a.loginSavedAt)}</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <AccountActions a={a} big />
          <button
            className="btn ghost"
            aria-label="Remover conta"
            title="Remover conta"
            onClick={() =>
              ask({
                title: `Remover @${a.username}?`,
                body: 'O login salvo no Supabase e os prints saem junto; a pasta do perfil continua neste PC (data/profiles).',
                ok: 'Remover',
                danger: true,
              }).then((ok) => ok && act.remove(a))
            }
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <DeviceBar a={a} />
      {a.attention && (
        <div style={{ marginBottom: 14 }}>
          <AttentionBox a={a} />
        </div>
      )}
      <div className="d-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Tela da sessão</h2>
              <span className="muted">O navegador da conta, ao vivo</span>
            </div>
            <LiveScreen a={a} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Meta de hoje</h2>
              <span className="mono" style={{ fontSize: 13 }}>
                {pct(a.completion)}% · {missing(a.plan, a.today)}
              </span>
            </div>
            <Goals a={a} meta={meta} />
            {a.dayStatus === 'limit' && (
              <div className="note">O que falta passaria de 120% do plano em outra meta. O resto fica para amanhã.</div>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Sessões</h2>
              <span className="muted">Últimas {full.history.length}</span>
            </div>
            {full.history.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Dia</th>
                      <th>Duração</th>
                      <th>Meta do dia</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {full.history.map((s) => (
                      <tr key={s.date}>
                        <td className="mono">
                          {ddmm(s.date.slice(0, 10))} {hhmm(Date.parse(s.date))}
                        </td>
                        <td>{s.day}</td>
                        <td>{String(s.minutes).replace('.', ',')} min</td>
                        <td>{pct(s.completion || 0)}%</td>
                        <td>
                          <span className={`res ${resultClass(s.result)}`}>{resultLabel(s)}</span>{' '}
                          {s.screenshot && (
                            <a className="link" href={`/api/accounts/${a.id}/screens/${s.screenshot}`} target="_blank" rel="noopener">
                              <Icon name="image" />
                              print
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-small">Nenhuma sessão ainda.</p>
            )}
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>
                Jornada{a.goal ? <span className="pill"> Meta: {a.goal.name}</span> : null}
                {a.goalRamp ? (
                  <span className="pill ready" title="Os números sobem no máximo +25% por dia até a meta nova">
                    {' '}
                    Em transição
                  </span>
                ) : null}
              </h2>
              <span className="muted">{readyLeft <= 0 ? 'Pronta' : `Pronta em ${readyLeft} ${readyLeft === 1 ? 'dia' : 'dias'}`}</span>
            </div>
            <div className="vj">
              {a.phases.map((p) => {
                const st = a.day > p.to ? 'done' : a.day >= p.from ? 'cur' : '';
                return (
                  <div key={p.n} className={`vj-item ${st}`}>
                    <div className="vj-dot">{st === 'done' ? <Icon name="check" /> : p.n}</div>
                    <div>
                      <h3>
                        {p.name} <small>{p.to >= 9999 ? `Dia ${p.from} em diante` : `Dias ${p.from} a ${p.to}`}</small>
                      </h3>
                      <p>{p.desc}</p>
                      {st === 'cur' && (
                        <div className="vj-now">
                          <span>Hoje: dia {a.day}</span>
                          {Object.keys(labels)
                            .filter((k) => (a.plan[k] || 0) > 0)
                            .map((k) => (
                              <span key={k}>
                                {a.plan[k]} {UNIT[k] ? UNIT[k][a.plan[k] === 1 ? 0 : 1] : labels[k]}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Saúde</h2>
              <span className="muted">{h.nodata ? 'Sem dados ainda' : healthLabel(h.score)}</span>
            </div>
            <div className="health-big">
              <Ring score={h.score} size={76} />
              <div className="h-rows">
                {hRow('Consistência', h.consistency, 'dias com sessão')}
                {hRow('Metas', h.completion, 'Últimas sessões')}
                {hRow('Segurança', h.safety, 'captcha e bloqueio na semana')}
              </div>
            </div>
            <div className="note">Falta de login, proxy fora do ar e dias de férias não contam contra a saúde.</div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Ajustes desta conta</h2>
            </div>
            <GoalPicker a={a} />
            <Settings a={a} full={full} />
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Checklist “conta pronta”</h2>
            </div>
            <Checklist a={a} meta={meta} />
          </section>
        </div>
      </div>
      <section className="panel mt">
        <div className="panel-head">
          <h2>Calendário da jornada</h2>
          <span className="muted">Um quadrado por dia; a cor mostra quanto da meta foi batido</span>
        </div>
        <div className="cal-wrap">
          <div>
            <Calendar a={a} meta={meta} />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Meta batida por dia · 30 dias
            </div>
            <BarChart
              vals={days30.map((d) => d.completion)}
              labels={days30.map((d) => ddmm(d.date))}
              aria={`Meta batida por dia de @${a.username}`}
            />
          </div>
        </div>
      </section>
      <Naturalidade full={full} />
      {full.screens.length > 0 && (
        <section className="panel mt">
          <div className="panel-head">
            <h2>Prints de problemas</h2>
            <span className="muted">captcha, bloqueio, erro e sessão travada</span>
          </div>
          <div className="shots">
            {full.screens.map((f) => (
              <a key={f} href={`/api/accounts/${a.id}/screens/${f}`} target="_blank" rel="noopener">
                <img loading="lazy" src={`/api/accounts/${a.id}/screens/${f}`} alt={f} />
                <span>
                  {new Date(shotInfo(f).at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · {RESULT_LABEL[shotInfo(f).tag] || 'Travou'}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      <section className="panel mt">
        <div className="panel-head">
          <h2>Eventos</h2>
          <span className="muted">Os mais recentes primeiro</span>
        </div>
        <div className="feed">
          {full.events.length ? (
            full.events.map((ev, i) => (
              <div key={`${ev.t}-${i}`} className="fi">
                <time>{when(ev.t)}</time>
                <span className={`k ${eventClass(ev)}`} />
                <div>{eventText(ev, labels)}</div>
              </div>
            ))
          ) : (
            <p className="empty-small">Nenhum evento ainda.</p>
          )}
        </div>
      </section>
    </>
  );
}
