// Ajustes: tema, navegador das sessões, motor (PM2 e inicialização) e backup dos logins.
import { api, type Config } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { duration } from '../lib/format.ts';
import { useStore } from '../store.tsx';
import { useTheme, type ThemePref } from '../lib/theme.ts';

const Ok = ({ on, yes, no }: { on: boolean; yes: string; no: string }) =>
  on ? (
    <span className="ok-text">
      <Icon name="check" />
      {yes}
    </span>
  ) : (
    <span className="dim">{no}</span>
  );

export function Ajustes() {
  const { config, setConfig, system, backup, act, run } = useStore();
  const [pref, setPref] = useTheme();
  if (!config) return null;
  const save = (patch: Partial<Config>) =>
    run(async () => {
      setConfig(await api<Config>('/api/config', 'POST', patch));
    }, 'Salvo. Vale a partir da próxima sessão.');
  const last = backup?.last;
  return (
    <div className="set-grid">
      <div className="stack">
        <section className="panel">
          <h2>Aparência</h2>
          <div className="set-row">
            <div>
              <b>Tema</b>
              <span>Segue o sistema ou fica fixo.</span>
            </div>
            <div className="seg seg3" role="group" aria-label="Tema">
              {(
                [
                  ['system', 'Sistema'],
                  ['light', 'Claro'],
                  ['dark', 'Escuro'],
                ] as [ThemePref, string][]
              ).map(([k, l]) => (
                <button key={k} aria-pressed={pref === k} onClick={() => setPref(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="panel">
          <h2>Navegador das sessões</h2>
          <div className="set-row">
            <div>
              <b>Esconder as janelas</b>
              <span>Com as janelas à vista, dá para acompanhar no PC. A tela ao vivo funciona dos dois jeitos.</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={config.headless}
                onChange={(e) => save({ headless: e.target.checked })}
                aria-label="Esconder as janelas"
              />
              <span />
            </label>
          </div>
          <div className="set-row">
            <div>
              <b>Sem som</b>
              <span>Os vídeos tocam mudos.</span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={config.muteAudio}
                onChange={(e) => save({ muteAudio: e.target.checked })}
                aria-label="Sem som"
              />
              <span />
            </label>
          </div>
        </section>
        <section className="panel">
          <h2>Motor</h2>
          <div className="set-row">
            <div>
              <b>Rodando há</b>
              <span>Versão {system?.version}</span>
            </div>
            <span className="mono">{system ? duration(system.uptime) : '—'}</span>
          </div>
          <div className="set-row">
            <div>
              <b>Reinicia sozinho se cair</b>
              <span>
                {system?.pm2
                  ? `Pelo PM2. Reinícios: ${system.restarts}.`
                  : 'Só quando ligado por "npm run ligar" (agora está pelo npm start).'}
              </span>
            </div>
            <Ok on={!!system?.pm2} yes="ligado" no="desligado" />
          </div>
          <div className="set-row">
            <div>
              <b>Liga junto com o Windows</b>
              <span>{system?.autostart ? 'Para tirar: npm run autostart:desligar' : 'Para ligar: npm run autostart:ligar'}</span>
            </div>
            <Ok on={!!system?.autostart} yes="ligado" no="desligado" />
          </div>
        </section>
      </div>
      <div className="stack">
        <section className="panel">
          <h2>Backup dos logins</h2>
          <p className="muted" style={{ marginTop: 10 }}>
            Todo dia às {backup?.at || '04:00'}, copia as sessões de login das contas, sem o cache do navegador. Se o PC der problema, você
            restaura sem precisar logar tudo de novo.
          </p>
          <dl className="kv">
            <div>
              <dt>Pasta</dt>
              <dd>{backup?.dir}</dd>
            </div>
            <div>
              <dt>Último</dt>
              <dd>{last?.at ? `${new Date(last.at).toLocaleString('pt-BR')} · ${last.sizeMB} MB` : 'nenhum ainda'}</dd>
            </div>
            <div>
              <dt>Guarda</dt>
              <dd>
                os {backup?.keep} mais recentes ({backup?.files.length || 0} agora)
              </dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>
                {backup?.running ? 'fazendo backup...' : backup?.due ? 'pendente: roda quando nenhuma conta estiver aberta' : 'em dia'}
              </dd>
            </div>
          </dl>
          {last?.error && <div className="err-box">O último backup falhou: {last.error}</div>}
          <button className="btn" onClick={() => act.backupNow()} disabled={backup?.running} style={{ marginTop: 12 }}>
            <Icon name="cloud" />
            Fazer backup agora
          </button>
          <p className="help" style={{ marginTop: 10 }}>
            Para restaurar: desligue o motor e rode <code>npm run restaurar</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
