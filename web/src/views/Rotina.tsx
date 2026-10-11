// Rotina: piloto automático, janela padrão, contas ao mesmo tempo, modo férias e janelas por conta.
import { useEffect, useState } from 'react';
import { api, type Config } from '../api.ts';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import { addDays, ddmm, hoursText, isoDate, windowSegments } from '../lib/format.ts';
import { useStore } from '../store.tsx';

function Track({ start, end }: { start: string; end: string }) {
  const X = (m: number) => (m / 1440) * 100;
  return (
    <div className="ag-track">
      {windowSegments(start, end).map(([s, e]) => (
        <span key={s} className="ag-win" style={{ left: `${X(s)}%`, width: `${X(e) - X(s)}%` }} title={`${start}–${end}`} />
      ))}
    </div>
  );
}

export function Rotina() {
  const { config, setConfig, accounts, run, go, reload, system, ask } = useStore();
  const [form, setForm] = useState<Pick<Config, 'start' | 'end' | 'max'> | null>(null);
  const [until, setUntil] = useState(addDays(isoDate(new Date()), 3));
  useEffect(() => {
    if (config && !form) setForm({ start: config.start, end: config.end, max: config.max });
  }, [config, form]);
  if (!config || !form) return null;
  const vacation = config.pausedUntil && config.pausedUntil > Date.now();
  const save = (patch: Partial<Config>, ok?: string) =>
    run(async () => {
      setConfig(await api<Config>('/api/config', 'POST', patch));
    }, ok);
  const dirty = form.start !== config.start || form.end !== config.end || form.max !== config.max;
  return (
    <>
      <div className="two">
        <section className="panel">
          <h2>Piloto automático</h2>
          <div className="set-row">
            <div>
              <b>Ligar e desligar as contas sozinho</b>
              <span>Respeita a janela, o limite de contas e a meta de cada uma.</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={config.active}
                onChange={(e) =>
                  save({ active: e.target.checked }, e.target.checked ? 'Piloto automático ligado' : 'Piloto automático desligado')
                }
                aria-label="Piloto automático"
              />
              <span />
            </label>
          </div>
          <div className="set-row">
            <div>
              <b>Janela padrão</b>
              <span>Vale para as contas sem horário próprio.</span>
            </div>
            <div className="field-row">
              <input
                className="input sm mono"
                type="time"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                aria-label="Início da janela"
              />
              <span className="dim">até</span>
              <input
                className="input sm mono"
                type="time"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                aria-label="Fim da janela"
              />
            </div>
          </div>
          <div className="set-row">
            <div>
              <b>Contas ao mesmo tempo</b>
              <span>Cada uma abre um navegador; mais que 2 pesa no PC.</span>
            </div>
            <input
              className="input sm mono"
              type="number"
              min={1}
              max={6}
              value={form.max}
              onChange={(e) => setForm({ ...form, max: Number(e.target.value) })}
              style={{ width: 72 }}
              aria-label="Contas ao mesmo tempo"
            />
          </div>
          <div className="set-row">
            <div>
              <b>Horário em que este PC fica ligado</b>
              <span>Aprendido nos últimos dias. As sessões caem dentro dele, para nenhum dia se perder com o PC desligado.</span>
            </div>
            <span className="mono">{hoursText(system?.onHours) || 'Aprendendo (2 dias)'}</span>
          </div>
          <div className="set-row">
            <div>
              <b>Intervalo entre sessões da mesma conta</b>
              <span>Sorteado a cada vez, para não ter horário fixo.</span>
            </div>
            <span className="mono">45–90 min</span>
          </div>
          {dirty && (
            <button className="btn primary sm" onClick={() => save(form, 'Rotina salva')}>
              Salvar rotina
            </button>
          )}
        </section>
        <section className="panel">
          <h2>Modo férias</h2>
          {vacation ? (
            <>
              <p className="muted" style={{ marginTop: 10 }}>
                Ligado. Nenhuma conta roda até {new Date(config.pausedUntil!).toLocaleDateString('pt-BR')}. Na volta, cada conta continua do
                dia do aquecimento em que parou.
              </p>
              <button
                className="btn"
                style={{ marginTop: 14 }}
                onClick={() =>
                  run(async () => {
                    setConfig(await api<Config>('/api/vacation', 'DELETE'));
                    reload();
                  }, 'Férias encerradas. As contas continuam de onde pararam.')
                }
              >
                <Icon name="play" />
                Voltar agora
              </button>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 10 }}>
                Pausa todas as contas e o piloto automático até o dia da volta. As sessões abertas fecham com segurança.
              </p>
              <div className="field-row" style={{ marginTop: 14 }}>
                <label htmlFor="vac-until" className="dim">
                  Volto no dia
                </label>
                <input
                  id="vac-until"
                  className="input sm mono"
                  type="date"
                  value={until}
                  min={addDays(isoDate(new Date()), 1)}
                  onChange={(e) => setUntil(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={async () =>
                    (await ask({ title: 'Modo férias', body: 'Pausar todas as contas até a data de volta?', ok: 'Pausar as contas' })) &&
                    run(
                      async () => {
                        setConfig(await api<Config>('/api/vacation', 'POST', { until }));
                      },
                      `Modo férias até ${ddmm(until)}`,
                    )
                  }
                >
                  <Icon name="pause" />
                  Pausar tudo
                </button>
              </div>
            </>
          )}
          <div className="note">
            Os dias de férias não contam contra a saúde, e a conta não pula de fase: o aquecimento continua do dia em que parou.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Janelas por conta</h2>
          <span className="muted">0h a 24h · fora da janela, a conta não aquece</span>
        </div>
        <div className="rot-scroll">
          <div className="rot-inner">
            {accounts.map((a) => {
              const w = a.window || { start: config.start, end: config.end };
              return (
                <div key={a.id} className="rot-row">
                  <div className="who-col">
                    <PlatformBadge platform={a.platform} size="xs" />
                    <div>
                      <b>@{a.username}</b>
                      <span>{a.window ? `${a.window.start}–${a.window.end}` : 'janela padrão'}</span>
                    </div>
                  </div>
                  <Track start={w.start} end={w.end} />
                  <button className="btn sm" onClick={() => go('conta', a.id)}>
                    Editar
                  </button>
                </div>
              );
            })}
            {!accounts.length && <p className="empty-small">Nenhuma conta ainda.</p>}
          </div>
        </div>
      </section>
    </>
  );
}
