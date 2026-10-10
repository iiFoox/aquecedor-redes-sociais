// Metas personalizadas: modelos de meta (prazo e números de cada fase) que cada conta pode usar no lugar da meta
// recomendada. Por conta e risco do dono: o editor mostra o recomendado ao lado e avisa o que foge dele, sem bloquear.
// O motor confere tudo de novo (motor/custom.js: limites) e mantém as proteções (teto de 120%, captcha, follows).
import { useEffect, useMemo, useState } from 'react';
import { api, type GoalTemplate, type Platform } from '../api.ts';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import { avisos, nivelDe, phasesFor, READY_DAY } from '../lib/meta.ts';
import { useStore } from '../store.tsx';

type Draft = Omit<GoalTemplate, 'id'> & { id?: string };
const MINUTES_LABEL = 'Minutos por dia (estimativa)';

export function Metas() {
  const { meta, accounts, run, toast } = useStore();
  const [list, setList] = useState<GoalTemplate[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = () =>
    api<{ templates: GoalTemplate[] }>('/api/metas')
      .then((r) => setList(r.templates))
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  if (!meta) return null;

  const fresh = (platform: Platform): Draft => ({
    name: '',
    platform,
    readyDay: READY_DAY,
    vary: true,
    phases: meta.platforms[platform].plans.map((p) => ({ ...p })),
  });
  const users = (id: string) => accounts.filter((a) => a.goal && a.goal.id === id);
  const remove = (t: GoalTemplate) => {
    const n = users(t.id).length;
    if (!confirm(`Apagar o modelo "${t.name}"?${n ? ` ${n} conta(s) voltam para a meta recomendada.` : ''}`)) return;
    run(async () => {
      await api(`/api/metas/${t.id}`, 'DELETE');
      await load();
    }, 'Modelo apagado');
  };

  if (draft)
    return (
      <Editor
        draft={draft}
        onCancel={() => setDraft(null)}
        onSaved={async (t) => {
          await load();
          setDraft(null);
          toast(`Modelo "${t.name}" salvo`, 'ok');
        }}
      />
    );

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Metas personalizadas</h2>
          <span>
            <button className="btn sm" onClick={() => setDraft(fresh('tiktok'))}>
              <Icon name="plus" /> Modelo do TikTok
            </button>{' '}
            <button className="btn sm" onClick={() => setDraft(fresh('instagram'))}>
              <Icon name="plus" /> Modelo do Instagram
            </button>
          </span>
        </div>
        <p className="muted">
          Crie modelos com o seu prazo e os seus números por fase e escolha, em cada conta, usar a meta recomendada ou um modelo (Conta →
          Ajustes desta conta → Meta). A meta recomendada nunca muda. <b>Meta personalizada é por sua conta e risco</b>: números acima do
          recomendado e prazos curtos aumentam a chance de captcha, bloqueio e restrição da conta.
        </p>
      </section>
      {list === null ? (
        <section className="panel empty">
          <span className="spinner" />
        </section>
      ) : !list.length ? (
        <section className="panel empty">
          <p className="muted">Nenhum modelo ainda. Todas as contas usam a meta recomendada.</p>
        </section>
      ) : (
        list.map((t) => {
          const plans = meta.platforms[t.platform].plans;
          const warn = avisos(t.platform, t, plans, meta.platforms[t.platform].actions);
          const risk = warn.filter((w) => w.nivel === 'risco').length;
          const used = users(t.id);
          return (
            <section key={t.id} className="panel">
              <div className="panel-head">
                <h2 className="meta-title">
                  <PlatformBadge platform={t.platform} size="xs" /> {t.name}
                </h2>
                <span>
                  <button className="btn sm" onClick={() => setDraft({ ...t, phases: t.phases.map((p) => ({ ...p })) })}>
                    Editar
                  </button>{' '}
                  <button
                    className="btn sm"
                    onClick={() => setDraft({ ...t, id: undefined, name: `${t.name} (cópia)`, phases: t.phases.map((p) => ({ ...p })) })}
                  >
                    Duplicar
                  </button>{' '}
                  <button className="btn sm" onClick={() => remove(t)} aria-label={`Apagar ${t.name}`}>
                    <Icon name="trash" />
                  </button>
                </span>
              </div>
              <p className="muted">
                Pronta no dia {t.readyDay} · {t.vary ? 'números variam um pouco por dia' : 'números exatos'} ·{' '}
                {used.length ? `usado por ${used.map((a) => `@${a.username}`).join(', ')}` : 'nenhuma conta usa'}
                {warn.length ? ` · ${warn.length} aviso(s)${risk ? `, ${risk} de risco` : ''}` : ' · dentro do recomendado'}
              </p>
            </section>
          );
        })
      )}
    </>
  );
}

function Editor({ draft, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: (t: GoalTemplate) => void }) {
  const { meta, run } = useStore();
  const [t, setT] = useState<Draft>(draft);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const plat = meta!.platforms[t.platform];
  const plans = plat.plans;
  const keys = Object.keys(plans[0]).filter((k) => k !== 'minutes');
  const labels = plat.actions;
  const phases = phasesFor(meta!.phases, t.readyDay || READY_DAY);
  const warn = useMemo(() => avisos(t.platform, t, plans, labels), [t, plans, labels]);
  const setCell = (i: number, k: string, v: string) =>
    setT({ ...t, phases: t.phases.map((p, j) => (j === i ? { ...p, [k]: v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)) } : p)) });
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    run(async () => {
      try {
        onSaved(await api<GoalTemplate>('/api/metas', 'POST', t));
      } catch (x) {
        setErr((x as Error).message);
        throw x;
      }
    });
  };
  const row = (k: string, label: string) => (
    <tr key={k}>
      <th>{label}</th>
      {t.phases.map((p, i) => {
        const lvl = nivelDe(warn, i + 1, k);
        return (
          <td key={i} className={lvl ? `meta-${lvl}` : ''}>
            <input
              className="input sm mono"
              type="number"
              min={0}
              value={p[k] ?? 0}
              onChange={(e) => setCell(i, k, e.target.value)}
              aria-label={`Fase ${i + 1}: ${label}`}
            />
            <span className="dim">rec. {plans[i][k]}</span>
          </td>
        );
      })}
    </tr>
  );
  return (
    <form onSubmit={save}>
      <section className="panel">
        <div className="panel-head">
          <h2 className="meta-title">
            <PlatformBadge platform={t.platform} size="xs" /> {draft.id ? 'Editar modelo' : 'Novo modelo'}
          </h2>
          <button
            type="button"
            className="btn sm"
            onClick={() => setT({ ...t, readyDay: READY_DAY, phases: plans.map((p) => ({ ...p })) })}
          >
            Voltar ao recomendado
          </button>
        </div>
        <div className="field-row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="meta-nome">Nome do modelo</label>
            <input
              id="meta-nome"
              className="input"
              value={t.name}
              maxLength={40}
              onChange={(e) => setT({ ...t, name: e.target.value })}
              placeholder="Ex.: Rápida 15 dias"
              required
            />
          </div>
          <div className="field" style={{ flex: '0 1 220px' }}>
            <label htmlFor="meta-dias">Dias até a conta ficar pronta</label>
            <input
              id="meta-dias"
              className="input mono"
              type="number"
              min={5}
              max={90}
              value={t.readyDay}
              onChange={(e) => setT({ ...t, readyDay: Math.round(Number(e.target.value) || 0) })}
              required
            />
            <span className="help">Recomendado: {READY_DAY}. As 5 fases se ajustam ao prazo, na mesma ordem.</span>
          </div>
        </div>
        <div className="set-row">
          <div>
            <b>Variar um pouco por dia</b>
            <span>Recomendado: os números mudam ~10% de um dia para o outro, como gente. Desligado: exatamente os números abaixo.</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={t.vary}
              onChange={(e) => setT({ ...t, vary: e.target.checked })}
              aria-label="Variar um pouco por dia"
            />
            <span />
          </label>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Por dia, em cada fase</h2>
          <span className="muted">"rec." é a meta recomendada</span>
        </div>
        <div className="table-wrap">
          <table className="meta-grid">
            <thead>
              <tr>
                <th></th>
                {phases.map((p) => (
                  <th key={p.n}>
                    Fase {p.n} · {p.name}
                    <br />
                    <span className="dim">
                      {p.to >= 9999 ? `dia ${p.from} em diante` : p.from === p.to ? `dia ${p.from}` : `dias ${p.from} a ${p.to}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => row(k, labels[k] || k))}
              {row('minutes', MINUTES_LABEL)}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Avisos</h2>
          <span className="muted">{warn.length ? `${warn.length}` : 'nenhum'}</span>
        </div>
        {warn.length ? (
          <ul className="guide-list">
            {warn.map((w, i) => (
              <li key={i} className={`meta-${w.nivel}`}>
                <b>{w.nivel === 'risco' ? 'Risco' : 'Atenção'}:</b> {w.msg}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Dentro do recomendado.</p>
        )}
        <p className="muted">
          Continuam valendo: nenhuma meta passa de 120% do plano do dia, captcha e bloqueio param a sessão na hora, e o TikTok pausa os
          follows se não estiver gravando.
        </p>
        <label className="set-row" style={{ cursor: 'pointer' }}>
          <div>
            <b>Entendo que a meta personalizada é por minha conta e risco</b>
          </div>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="Entendo o risco" />
        </label>
        {err && <p className="form-err">{err}</p>}
        <div className="field-row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn primary" type="submit" disabled={!ok || !t.name.trim()}>
            Salvar modelo
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </section>
    </form>
  );
}
