// Metas personalizadas: modelos de meta (prazo e números de cada fase) que cada conta pode usar no lugar da meta
// recomendada. Por conta e risco do dono: o editor mostra o recomendado ao lado e avisa o que foge dele; só bloqueia o
// que o motor recusaria (fora do limite ou impossível de fazer). O motor confere tudo de novo (motor/custom.js) e
// mantém as proteções (teto do dia = o número escrito, transição suave ao trocar de meta, captcha, pausa de follows).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Account, type GoalTemplate, type Phase, type Platform } from '../api.ts';
import { Icon, PlatformBadge } from '../components/Icon.tsx';
import {
  avisos,
  mudancaDeFase,
  nivelDe,
  phasesFor,
  presets,
  READY_DAY,
  resumo,
  serie,
  total,
  type Limits,
  type Preset,
} from '../lib/meta.ts';
import { useStore } from '../store.tsx';

type Draft = Omit<GoalTemplate, 'id' | 'updatedAt'> & { id?: string; updatedAt?: string };
type Nums = Record<string, number>;
const PLAT: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram' };
const LEAVE = 'As mudanças neste modelo ainda não foram salvas.';
const MINUTES_LABEL = 'Minutos de uso por dia';
const clone = (phases: Nums[]) => phases.map((p) => ({ ...p }));
const pad = (n: number) => String(n).padStart(2, '0');
const quando = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dias = (p: Phase) => (p.to >= 9999 ? `dia ${p.from} em diante` : p.from === p.to ? `dia ${p.from}` : `dias ${p.from} a ${p.to}`);
const onde = (a: Account) => (a.mine ? 'neste aparelho' : a.deviceName ? `em ${a.deviceName}` : 'sem aparelho');

// Largura de celular: o editor troca a tabela de 5 colunas por uma fase por cartão
function useNarrow(q = '(max-width: 760px)') {
  const [m, setM] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function Metas() {
  const { meta, accounts, run, toast, ask, go, reload } = useStore();
  const [list, setList] = useState<GoalTemplate[] | null>(null);
  const [limits, setLimits] = useState<Limits>({});
  const [open, setOpen] = useState<{ draft: Draft; toContas?: boolean } | null>(null);
  const load = () =>
    api<{ templates: GoalTemplate[]; limits: Limits }>('/api/metas')
      .then((r) => {
        setList(r.templates);
        setLimits(r.limits || {});
      })
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
    phases: clone(meta.platforms[platform].plans),
  });
  const users = (id: string) => accounts.filter((a) => a.goal && a.goal.id === id);
  const edit = (t: GoalTemplate, toContas = false) => setOpen({ draft: { ...t, phases: clone(t.phases) }, toContas });
  const remove = async (t: GoalTemplate) => {
    const n = users(t.id);
    const ok = await ask({
      title: `Apagar o modelo "${t.name}"?`,
      body: n.length
        ? `${n.map((a) => `@${a.username}`).join(', ')} ${n.length === 1 ? 'volta' : 'voltam'} para a meta recomendada.`
        : 'Nenhuma conta usa este modelo.',
      ok: 'Apagar',
      danger: true,
    });
    if (ok)
      run(async () => {
        await api(`/api/metas/${t.id}`, 'DELETE');
        await load();
      }, 'Modelo apagado');
  };

  if (open)
    return (
      <Editor
        key={open.draft.id || 'novo'}
        draft={open.draft}
        toContas={!!open.toContas}
        limits={limits}
        onClose={() => setOpen(null)}
        onSaved={async (msg, bad) => {
          await load();
          reload().catch(() => {});
          setOpen(null);
          toast(msg, bad ? 'bad' : 'ok');
        }}
      />
    );

  const sorted = [...(list || [])].sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Metas personalizadas</h2>
          <span className="meta-acoes">
            <button className="btn sm" onClick={() => setOpen({ draft: fresh('tiktok') })}>
              <Icon name="plus" /> Modelo do TikTok
            </button>
            <button className="btn sm" onClick={() => setOpen({ draft: fresh('instagram') })}>
              <Icon name="plus" /> Modelo do Instagram
            </button>
          </span>
        </div>
        <p className="muted">
          Crie modelos com o seu prazo e os seus números por fase e escolha as contas que usam cada um (no próprio modelo ou na conta:
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
        <div className="meta-cards">
          {sorted.map((t) => {
            const plat = meta.platforms[t.platform];
            const warn = avisos(t.platform, t, plat.plans, plat.actions, limits);
            const used = users(t.id);
            const last = t.phases[4];
            return (
              <section key={t.id} className="panel meta-card">
                <div className="meta-card-head">
                  <PlatformBadge platform={t.platform} size="xs" />
                  <h2>{t.name}</h2>
                  <span className="meta-prazo" title="Dias até a conta ficar pronta">
                    <b>{t.readyDay}</b> dias
                  </span>
                </div>
                <p className="dim meta-card-sub">
                  {PLAT[t.platform]} · {t.vary ? 'varia um pouco por dia (só para baixo)' : 'números exatos'}
                  {t.updatedAt ? ` · editado em ${quando(t.updatedAt)}` : ''}
                </p>
                <div className="meta-f5">
                  <span className="dim">Conta pronta (fase 5, dia {t.readyDay} em diante), por dia:</span>
                  <div className="meta-nums">
                    {Object.keys(plat.plans[0])
                      .filter((k) => k !== 'minutes')
                      .map((k) => {
                        const lvl = nivelDe(warn, 5, k);
                        return (
                          <span key={k} className={`meta-num${lvl ? ` meta-${lvl}` : ''}`}>
                            <b>{last[k] ?? 0}</b> {(plat.actions[k] || k).toLowerCase()}
                          </span>
                        );
                      })}
                  </div>
                </div>
                <div className="meta-pills">
                  {warn.length ? (
                    (['erro', 'risco', 'atencao'] as const).map((n) => {
                      const c = warn.filter((w) => w.nivel === n).length;
                      return c ? (
                        <span key={n} className={`pill meta-pill-${n}`}>
                          {c}{' '}
                          {n === 'erro'
                            ? c === 1
                              ? 'erro'
                              : 'erros'
                            : n === 'risco'
                              ? c === 1
                                ? 'risco'
                                : 'riscos'
                              : c === 1
                                ? 'atenção'
                                : 'atenções'}
                        </span>
                      ) : null;
                    })
                  ) : (
                    <span className="pill hit">dentro do recomendado</span>
                  )}
                </div>
                <div className="meta-users">
                  <span className="dim">Contas:</span>
                  {used.length ? (
                    used.map((a) => (
                      <button key={a.id} className="tag-btn" onClick={() => go('conta', a.id)} title="Abrir a conta">
                        @{a.username}
                      </button>
                    ))
                  ) : (
                    <span className="dim">nenhuma usa ainda</span>
                  )}
                </div>
                <div className="meta-card-foot">
                  <button className="btn sm primary" onClick={() => edit(t, true)}>
                    Aplicar em contas
                  </button>
                  <button className="btn sm" onClick={() => edit(t)}>
                    Editar
                  </button>
                  <button
                    className="btn sm"
                    onClick={() =>
                      setOpen({ draft: { ...t, id: undefined, updatedAt: undefined, name: `${t.name} (cópia)`, phases: clone(t.phases) } })
                    }
                  >
                    Duplicar
                  </button>
                  <button className="btn sm ghost" onClick={() => remove(t)} aria-label={`Apagar ${t.name}`} title="Apagar">
                    <Icon name="trash" />
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Editor({
  draft,
  toContas,
  limits,
  onClose,
  onSaved,
}: {
  draft: Draft;
  toContas: boolean;
  limits: Limits;
  onClose: () => void;
  onSaved: (msg: string, bad: boolean) => void;
}) {
  const { meta, accounts, ask, setLeaveGuard } = useStore();
  const narrow = useNarrow();
  const [t, setT] = useState<Draft>(draft);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState<{ fase: number; key: string } | null>(null);
  const base = meta!.phases;
  const plat = meta!.platforms[t.platform];
  const plans = plat.plans;
  const labels = plat.actions;
  const keys = [...Object.keys(plans[0]).filter((k) => k !== 'minutes'), 'minutes'];
  const label = (k: string) => (k === 'minutes' ? MINUTES_LABEL : labels[k] || k);
  const validDays = t.readyDay >= 5 && t.readyDay <= 90 ? t.readyDay : READY_DAY;
  const phases = phasesFor(base, validDays);
  const warn = useMemo(() => avisos(t.platform, t, plans, labels, limits), [t, plans, labels, limits]);
  const errs = warn.filter((w) => w.nivel === 'erro');
  const risky = warn.some((w) => w.nivel !== 'erro');

  // Contas da mesma plataforma que vão usar este modelo (marcar aqui = trocar a meta da conta ao salvar)
  const mine = accounts.filter((a) => a.platform === t.platform);
  const using = (a: Account) => !!draft.id && !!a.goal && a.goal.id === draft.id;
  const [initialSel] = useState(() => mine.filter(using).map((a) => a.id));
  const [sel, setSel] = useState<Set<string>>(() => new Set(initialSel));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Mudança não salva: perguntar antes de sair (menu, voltar, fechar a janela)
  const dirty = JSON.stringify(t) !== JSON.stringify(draft) || [...sel].sort().join() !== [...initialSel].sort().join();
  useEffect(() => setLeaveGuard(dirty ? LEAVE : null), [dirty, setLeaveGuard]);
  useEffect(() => () => setLeaveGuard(null), [setLeaveGuard]);
  const contasRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (toContas) contasRef.current?.scrollIntoView({ block: 'start' });
  }, [toContas]);

  const cancel = async () => {
    if (
      dirty &&
      !(await ask({ title: 'Descartar as mudanças?', body: LEAVE, ok: 'Descartar', cancel: 'Continuar editando', danger: true }))
    )
      return;
    setLeaveGuard(null);
    onClose();
  };
  const start = async (p: Preset) => {
    const changed = JSON.stringify(t.phases) !== JSON.stringify(draft.phases) || t.readyDay !== draft.readyDay;
    if (
      changed &&
      !(await ask({
        title: `Começar de "${p.name}"?`,
        body: 'O prazo e os números que você mudou aqui são trocados pelos deste ponto de partida.',
        ok: 'Trocar',
      }))
    )
      return;
    setT({ ...t, readyDay: p.readyDay, phases: clone(p.phases) });
  };
  const setCell = (i: number, k: string, v: string) =>
    setT({ ...t, phases: t.phases.map((p, j) => (j === i ? { ...p, [k]: v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)) } : p)) });

  const blocked = !t.name.trim()
    ? 'Dê um nome ao modelo para salvar.'
    : errs.length
      ? `Corrija ${errs.length === 1 ? 'o erro' : `os ${errs.length} erros`} em vermelho para salvar.`
      : risky && !ok
        ? 'Marque que entende o risco para salvar.'
        : '';
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked || saving) return;
    setErr('');
    setSaving(true);
    try {
      const saved = await api<GoalTemplate>('/api/metas', 'POST', t);
      // Troca a meta só das contas que mudaram: marcadas passam a usar o modelo; desmarcadas que usavam voltam à recomendada
      const fails: string[] = [];
      let moved = 0;
      for (const a of mine) {
        const want = sel.has(a.id);
        if (want === (!!a.goal && a.goal.id === saved.id)) continue;
        try {
          await api(`/api/accounts/${a.id}`, 'PATCH', { goalTemplate: want ? saved.id : null });
          moved++;
        } catch {
          fails.push(`@${a.username}`);
        }
      }
      setLeaveGuard(null);
      onSaved(
        fails.length
          ? `Modelo salvo, mas não deu para trocar a meta de ${fails.join(', ')}. Tente pela conta.`
          : `Modelo "${saved.name}" salvo${moved ? ` · meta trocada em ${moved} conta${moved === 1 ? '' : 's'}` : ''}`,
        fails.length > 0,
      );
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cell = (i: number, k: string) => {
    const lvl = nivelDe(warn, i + 1, k);
    const msgs = warn.filter((w) => w.fase === i + 1 && w.key === k).map((w) => w.msg);
    const lim = limits[k];
    const v = t.phases[i][k] ?? 0;
    return (
      <div className={`meta-cell${lvl ? ` meta-${lvl}` : ''}`} title={msgs.join('\n') || undefined}>
        <input
          className="input sm mono"
          type="number"
          min={lim ? lim[0] : 0}
          max={lim ? lim[1] : undefined}
          value={v}
          onChange={(e) => setCell(i, k, e.target.value)}
          onFocus={() => setFocus({ fase: i + 1, key: k })}
          aria-label={`Fase ${i + 1}: ${label(k)}`}
          aria-invalid={lvl === 'erro' || undefined}
        />
        <span className="dim">
          {lim && (v > lim[1] || v < lim[0]) ? `${v > lim[1] ? 'máx.' : 'mín.'} ${v > lim[1] ? lim[1] : lim[0]}` : `rec. ${plans[i][k]}`}
        </span>
      </div>
    );
  };
  const focused = focus ? warn.filter((w) => w.fase === focus.fase && w.key === focus.key) : [];
  const live = mine.filter((a) => a.live && (sel.has(a.id) || using(a)));

  return (
    <form onSubmit={save} className="meta-editor">
      <section className="panel">
        <div className="panel-head">
          <h2 className="meta-title">
            <PlatformBadge platform={t.platform} size="xs" /> {draft.id ? `Editar "${draft.name}"` : `Novo modelo do ${PLAT[t.platform]}`}
          </h2>
          {draft.updatedAt ? <span className="muted">editado em {quando(draft.updatedAt)}</span> : null}
        </div>
        <div className="meta-presets">
          <span className="dim">Começar de:</span>
          {presets(plans).map((p) => (
            <button key={p.key} type="button" className="btn sm" onClick={() => start(p)} title={p.desc}>
              {p.name} <span className="dim">· {p.readyDay} dias</span>
            </button>
          ))}
        </div>
        <div className="meta-campos">
          <div className="field">
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
            <span className="help">Aparece na conta e no seletor de meta. Não pode repetir na mesma rede.</span>
          </div>
          <div className="field">
            <label htmlFor="meta-dias">Dias até a conta ficar pronta</label>
            <input
              id="meta-dias"
              className={`input mono${warn.some((w) => w.key === 'readyDay') ? ' meta-input-erro' : ''}`}
              type="number"
              min={5}
              max={90}
              value={t.readyDay}
              onChange={(e) => setT({ ...t, readyDay: Math.round(Number(e.target.value) || 0) })}
              required
            />
            <span className="help">De 5 a 90 (recomendado {READY_DAY}). As 5 fases se ajustam ao prazo, na mesma ordem.</span>
          </div>
        </div>
        <div className="set-row">
          <div>
            <b>Variar um pouco por dia</b>
            <span>
              Recomendado: o número de cada dia fica até ~10% abaixo do que você escreveu, como gente (nunca acima; até 2 não varia).
              Desligado: exatamente os números abaixo.
            </span>
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
          <span className="muted">o número é o máximo do dia · "rec." é a meta recomendada</span>
        </div>
        {narrow ? (
          <div className="meta-fases">
            {phases.map((p, i) => (
              <div key={p.n} className="meta-fase">
                <h3>
                  Fase {p.n} · {p.name} <span className="dim">{dias(p)}</span>
                </h3>
                <div className="meta-fase-grid">
                  {keys.map((k) => (
                    <div key={k} className="meta-fase-item">
                      <span>{label(k)}</span>
                      {cell(i, k)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="meta-grid">
              <thead>
                <tr>
                  <th></th>
                  {phases.map((p) => (
                    <th key={p.n}>
                      Fase {p.n} · {p.name}
                      <br />
                      <span className="dim">{dias(p)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k}>
                    <th>{label(k)}</th>
                    {t.phases.map((_, i) => (
                      <td key={i}>{cell(i, k)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {focused.length ? (
          <ul className="meta-foco">
            {focused.map((w, i) => (
              <li key={i} className={`meta-${w.nivel}`}>
                <b>{w.nivel === 'erro' ? 'Erro' : w.nivel === 'risco' ? 'Risco' : 'Atenção'}:</b> {w.msg}
              </li>
            ))}
          </ul>
        ) : warn.some((w) => w.fase) ? (
          <p className="help meta-foco-dica">Clique (ou toque) num número colorido para ver o aviso dele aqui.</p>
        ) : null}
        <p className="help">
          <b>{MINUTES_LABEL}</b> não é só estimativa: define quantas sessões a Rotina marca no dia (uma a cada ~7 minutos, até 4) e o tempo
          máximo de cada sessão (2,5x este número, entre 30 e 90 minutos).
        </p>
      </section>

      <Previa t={t} days={validDays} plans={plans} labels={labels} base={base} />

      <section className="panel" ref={contasRef}>
        <div className="panel-head">
          <h2>Contas que vão usar este modelo</h2>
          <span className="muted">{sel.size ? `${sel.size} marcada${sel.size === 1 ? '' : 's'}` : 'nenhuma'}</span>
        </div>
        {mine.length ? (
          <div className="meta-contas">
            {mine.map((a) => {
              const on = sel.has(a.id);
              const was = using(a);
              const now = a.goal ? (was ? 'usa este modelo' : `usa "${a.goal.name}"`) : 'usa a recomendada';
              const notes: ReactNode[] = [];
              if (on && !was) {
                if (a.goal) notes.push(`Sai do modelo "${a.goal.name}".`);
                notes.push(mudancaDeFase(base, a.day, a.readyDay, validDays));
                if (!a.mine) notes.push(`Roda ${onde(a)}: a troca chega lá pela internet.`);
              }
              if (!on && was) notes.push('Volta para a meta recomendada.');
              if ((on || was) && a.live)
                notes.push('Sessão rodando agora: ela termina com o plano antigo; a mudança vale a partir da próxima.');
              return (
                <label key={a.id} className={`meta-conta${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} aria-label={`Usar em @${a.username}`} />
                  <span>
                    <b>@{a.username}</b>
                    <span className="dim">
                      {onde(a)} · dia {a.day} · {now}
                    </span>
                    {notes.map((n, i) => (
                      <span key={i} className="meta-conta-nota">
                        {n}
                      </span>
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="muted">Nenhuma conta do {PLAT[t.platform]} ainda.</p>
        )}
        <p className="muted">
          Ao salvar, as contas marcadas passam a usar este modelo e o plano de hoje delas é refeito. Desmarcar uma conta que usava este
          modelo devolve ela para a meta recomendada. Também dá para trocar pela conta (Ajustes desta conta → Meta).
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Avisos</h2>
          <span className="muted">{resumo(warn) || 'nenhum'}</span>
        </div>
        {warn.length ? (
          <ul className="guide-list">
            {warn.map((w, i) => (
              <li key={i} className={`meta-${w.nivel}`}>
                <b>{w.nivel === 'erro' ? 'Erro' : w.nivel === 'risco' ? 'Risco' : 'Atenção'}:</b> {w.msg}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Dentro do recomendado.</p>
        )}
        <p className="muted">
          Continuam valendo: nenhum dia passa do número que você escreveu, trocar de meta sobe os números aos poucos (no máximo +25% por
          dia), captcha e bloqueio param a sessão na hora, e o TikTok pausa os follows se não estiver gravando.
        </p>
      </section>

      <section className="panel meta-save">
        <div className="meta-save-row">
          <span>
            <b>Resumo:</b>{' '}
            <span className={errs.length ? 'meta-txt-erro' : warn.some((w) => w.nivel === 'risco') ? 'meta-txt-risco' : ''}>
              {resumo(warn) || 'dentro do recomendado'}
            </span>
          </span>
          {risky ? (
            <label className="meta-aceite">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="Entendo o risco" />
              Entendo que a meta personalizada é por minha conta e risco
            </label>
          ) : null}
        </div>
        {live.length ? (
          <p className="help">
            {live.map((a) => `@${a.username}`).join(', ')} {live.length === 1 ? 'está' : 'estão'} com sessão rodando: ela termina com o
            plano antigo; a mudança vale a partir da próxima sessão.
          </p>
        ) : null}
        {err && <p className="form-err">{err}</p>}
        <div className="meta-save-btns">
          <button className="btn primary" type="submit" disabled={!!blocked || saving}>
            {saving ? 'Salvando...' : 'Salvar modelo'}
          </button>
          <button className="btn" type="button" onClick={cancel}>
            Cancelar
          </button>
        </div>
        {blocked ? <p className="help meta-bloqueio">{blocked}</p> : null}
      </section>
    </form>
  );
}

// Prévia: o máximo de cada dia (do dia 1 até alguns dias depois de pronta) com a recomendada atrás, e os totais
function Previa({
  t,
  days: readyDay,
  plans,
  labels,
  base,
}: {
  t: Draft;
  days: number;
  plans: Nums[];
  labels: Record<string, string>;
  base: Phase[];
}) {
  const keys = Object.keys(plans[0]).filter((k) => k !== 'minutes');
  const [k, setK] = useState(keys.includes('like') ? 'like' : keys[0]);
  const n = Math.max(readyDay, READY_DAY) + 4;
  const mine = serie(base, t.phases, readyDay, k, n);
  const rec = serie(base, plans, READY_DAY, k, n);
  const max = Math.max(1, ...mine, ...rec);
  const W = 1000;
  const H = 210;
  const L = 34;
  const B = 22;
  const x = (d: number) => L + ((d - 1) / n) * (W - L - 8);
  const y = (v: number) => 8 + (1 - v / max) * (H - B - 8);
  const path = (s: number[]) =>
    s.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)} L${x(i + 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const totals = (ph: Nums[], rd: number) =>
    keys
      .map((key) => ({ key, v: total(base, ph, rd, key) }))
      .filter((x) => x.v > 0)
      .map((x) => `${x.v} ${(labels[x.key] || x.key).toLowerCase()}`)
      .join(', ');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Prévia</h2>
        <span className="muted">o máximo de cada dia (com "variar" ligado, um pouco menos)</span>
      </div>
      <div className="tags" role="group" aria-label="Meta da prévia">
        {keys.map((key) => (
          <button key={key} type="button" className="tag-btn" aria-pressed={key === k} onClick={() => setK(key)}>
            {labels[key] || key}
          </button>
        ))}
      </div>
      <svg
        className="meta-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${labels[k] || k} por dia: este modelo e a recomendada`}
      >
        <line x1={L} x2={W - 8} y1={y(0)} y2={y(0)} className="meta-chart-axis" />
        <text x={L - 6} y={y(max) + 4} textAnchor="end" className="meta-chart-txt">
          {max}
        </text>
        <text x={L - 6} y={y(0) + 4} textAnchor="end" className="meta-chart-txt">
          0
        </text>
        <line x1={x(READY_DAY)} x2={x(READY_DAY)} y1={8} y2={y(0)} className="meta-chart-rec-day" />
        <line x1={x(readyDay)} x2={x(readyDay)} y1={8} y2={y(0)} className="meta-chart-day" />
        <path d={path(rec)} className="meta-chart-rec" />
        <path d={path(mine)} className="meta-chart-mine" />
        {[1, readyDay, READY_DAY, n]
          .filter((d, i, a) => a.indexOf(d) === i)
          .map((d) => (
            <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="meta-chart-txt">
              {d === 1 ? 'dia 1' : d === n ? `${d}` : `dia ${d}`}
            </text>
          ))}
      </svg>
      <div className="meta-legenda">
        <span>
          <i className="meta-leg-mine" /> Este modelo (pronta no dia {readyDay})
        </span>
        <span>
          <i className="meta-leg-rec" /> Recomendada (pronta no dia {READY_DAY})
        </span>
      </div>
      <p className="help">
        <b>Até ficar pronta (dia {readyDay}):</b> ~{totals(t.phases, readyDay) || 'nada'}.
        <br />
        <b>Recomendada (dia {READY_DAY}):</b> ~{totals(plans, READY_DAY)}.
      </p>
    </section>
  );
}
