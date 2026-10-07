// Análises: números dos últimos 30 dias, minutos por dia e tabela por conta.
import { BarChart } from '../components/bits.tsx';
import { PlatformBadge } from '../components/Icon.tsx';
import { ddmm, pct } from '../lib/format.ts';
import { useStore } from '../store.tsx';

export function Analises() {
  const { accounts, go } = useStore();
  if (!accounts.length) return <div className="panel empty-small">Sem contas ainda.</div>;
  const dates = accounts[0].days.slice(-30).map((d) => d.date);
  const mins = dates.map((date) => accounts.reduce((s, a) => s + (a.days.find((d) => d.date === date)?.minutes || 0), 0));
  const total = mins.reduce((s, v) => s + v, 0);
  const sessions = accounts.reduce((s, a) => s + a.month.sessions, 0);
  const ok = accounts.reduce((s, a) => s + a.month.ok, 0);
  const grave = accounts.reduce((s, a) => s + a.month.grave, 0);
  const top = Math.max(60, Math.ceil(Math.max(...mins) / 60) * 60);
  return (
    <>
      <div className="kpis">
        <div className="inst">
          <div className="eyebrow">Sessões</div>
          <div className="big">{sessions}</div>
          <div className="sub">nos últimos 30 dias</div>
        </div>
        <div className="inst">
          <div className="eyebrow">Sessões concluídas</div>
          <div className="big">{sessions ? `${pct(ok / sessions)}%` : '—'}</div>
          <div className="sub">
            {ok} de {sessions}; as outras foram interrompidas, sem login ou com problema
          </div>
        </div>
        <div className="inst">
          <div className="eyebrow">Tempo de tela</div>
          <div className="big">{(total / 60).toFixed(1).replace('.', ',')} h</div>
          <div className="sub">somando todas as contas</div>
        </div>
        <div className={`inst ${grave ? 'attention' : ''}`}>
          <div className="eyebrow">Captchas e bloqueios</div>
          <div className="big">{grave}</div>
          <div className="sub">{grave ? 'veja os prints na página de cada conta' : 'nenhum em 30 dias'}</div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Minutos por dia</h2>
          <span className="muted">todas as contas · 30 dias</span>
        </div>
        <BarChart
          vals={mins}
          labels={dates.map(ddmm)}
          max={top}
          ticks={[0, top / 2, top]}
          fmt={(v) => `${Math.round(v)} min`}
          fullAt={null}
          aria="Minutos de sessão por dia, todas as contas"
        />
      </section>
      <section className="panel mt">
        <div className="panel-head">
          <h2>Por conta</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Dia</th>
                <th>Fase</th>
                <th>Meta média</th>
                <th>Saúde</th>
                <th>Concluídas</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const vals = a.days.slice(-30).filter((d) => d.completion != null && !d.vacation);
                const avg = vals.length ? vals.reduce((s, d) => s + Math.min(1, d.completion!), 0) / vals.length : 0;
                return (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="who"
                        onClick={() => go('conta', a.id)}
                        style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}
                      >
                        <PlatformBadge platform={a.platform} size="xs" />@{a.username}
                      </button>
                    </td>
                    <td>{a.day}</td>
                    <td>{a.phase.name}</td>
                    <td className="mono">{vals.length ? `${pct(avg)}%` : '—'}</td>
                    <td className="mono">{a.health.nodata ? '—' : a.health.score}</td>
                    <td className="mono">
                      {a.month.ok}/{a.month.sessions}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
