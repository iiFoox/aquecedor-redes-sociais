// Conta nova em 3 passos: conta + proxy (antes do login, para logar já no IP certo), login (janela no PC) e interesses.
import { useEffect, useState } from 'react';
import { api, type Account, type Platform } from '../api.ts';
import { addDays, ddmm, isoDate } from '../lib/format.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';

const SUGGEST: Record<Platform, string[]> = {
  tiktok: ['IA', 'comédia', 'tecnologia', 'curiosidades', 'finanças', 'games'],
  instagram: ['receitas', 'fitness', 'viagem', 'moda', 'decoração', 'pets'],
};

type LoginState = 'idle' | 'waiting' | 'done' | 'closed';

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { meta, proxies, lastEvent, run, go, reload } = useStore();
  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>('tiktok');
  const [handle, setHandle] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [acc, setAcc] = useState<Account | null>(null);
  const [login, setLogin] = useState<LoginState>('idle');
  const [interests, setInterests] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [proxy, setProxy] = useState(proxies.some((p) => p.status === 'online') ? 'auto' : '');

  // O motor avisa quando o login é detectado (aviso resolvido) e quando a janela fecha
  useEffect(() => {
    if (!acc || !lastEvent || lastEvent.id !== acc.id || login !== 'waiting') return;
    if (lastEvent.type === 'attention' && !lastEvent.attention) setLogin('done');
    if (lastEvent.type === 'login' && lastEvent.open === false) setLogin((s) => (s === 'waiting' ? 'closed' : s));
  }, [lastEvent, acc, login]);

  const today = isoDate(new Date());
  const readyDay = meta?.readyDay || 22;

  const next = async () => {
    if (step === 1) {
      const u = handle.trim().replace(/^@/, '');
      if (!u) return setErr('Digite o @ da conta para continuar.');
      if (!acc) {
        setBusy(true);
        try {
          setAcc(await api<Account>('/api/accounts', 'POST', { platform, username: u, proxy }));
          setErr('');
          reload();
        } catch (e) {
          setBusy(false);
          return setErr(e instanceof Error ? e.message : String(e));
        }
        setBusy(false);
      }
    }
    setStep(step + 1);
  };

  const openLogin = async () => {
    if (!acc) return;
    setLogin('waiting');
    const r = await run(() => api(`/api/accounts/${acc.id}/login`, 'POST'));
    if (r === undefined) setLogin('idle');
  };

  const finish = async () => {
    if (!acc) return;
    const r = await run(() => api(`/api/accounts/${acc.id}`, 'PATCH', { interests }), `@${acc.username} entrou no dia 1 do aquecimento`);
    if (r === undefined) return;
    onClose();
    go('conta', acc.id);
  };

  const steps = ['Conta e proxy', 'Login', 'Interesses'];
  const sug = SUGGEST[platform];
  const tags = [...sug, ...interests.filter((t) => !sug.includes(t))];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && step === 1 && !acc && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <h2 id="ob-title">Nova conta</h2>
        <div className="stepper">
          {steps.map((s, i) => (
            <span key={s} style={{ display: 'contents' }}>
              {i > 0 && <span className="dim">›</span>}
              <span className={`step ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}`}>
                <b>{i + 1 < step ? '✓' : i + 1}</b>
                {s}
              </span>
            </span>
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="field">
              <span className="lbl">Plataforma</span>
              <div className="seg" role="group" aria-label="Plataforma">
                {(['tiktok', 'instagram'] as Platform[]).map((p) => (
                  <button
                    key={p}
                    aria-pressed={platform === p}
                    disabled={!!acc}
                    onClick={() => {
                      setPlatform(p);
                      setInterests([]);
                    }}
                  >
                    <Icon name={p} />
                    {p === 'tiktok' ? 'TikTok' : 'Instagram'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="ob-handle">Usuário da conta</label>
              <input
                className="input"
                id="ob-handle"
                placeholder="@usuario"
                autoComplete="off"
                autoFocus
                value={handle}
                disabled={!!acc}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && next()}
              />
              {err && <span className="form-err">{err}</span>}
              <span className="help">
                O dia 1 do aquecimento começa hoje ({ddmm(today)}). A conta fica pronta no dia {readyDay}, em{' '}
                {ddmm(addDays(today, readyDay - 1))}.
              </span>
            </div>
            <div className="field">
              <label htmlFor="ob-proxy">Proxy</label>
              <select id="ob-proxy" className="input select" value={proxy} disabled={!!acc} onChange={(e) => setProxy(e.target.value)}>
                <option value="">Sem proxy (internet de casa)</option>
                {proxies.some((p) => p.status === 'online') && <option value="auto">Automático (o online com menos contas)</option>}
                {proxies.map((p) => (
                  <option key={p.id} value={p.url}>
                    {new URL(p.url).host} · {p.status === 'online' ? `${p.ms} ms` : p.status === 'offline' ? 'fora do ar' : 'não testado'} ·{' '}
                    {p.accounts.length} conta(s)
                  </option>
                ))}
              </select>
              {!proxies.length && <span className="help">Cadastre proxies na tela Proxies para escolher aqui.</span>}
              <span className="help">Escolha antes do login: a conta entra e aquece sempre pelo mesmo IP.</span>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="login-box">
              <p>
                Uma janela do navegador abre no PC. Entre na conta normalmente, com código ou verificação se pedirem. Quando o login for
                detectado, a janela fecha sozinha e a sessão fica salva.
              </p>
              {login === 'idle' && (
                <button className="btn primary" onClick={openLogin} style={{ justifySelf: 'start' }}>
                  <Icon name="key" />
                  Abrir janela de login
                </button>
              )}
              {login === 'waiting' && (
                <div className="login-state">
                  <span className="spinner" />
                  Aguardando você entrar na conta na janela do navegador…
                </div>
              )}
              {login === 'done' && (
                <div className="login-state ok-text">
                  <Icon name="check" />
                  Login detectado e salvo. A janela fechou sozinha.
                </div>
              )}
              {login === 'closed' && (
                <>
                  <div className="login-state">A janela fechou antes de o login ser detectado.</div>
                  <button className="btn" onClick={openLogin} style={{ justifySelf: 'start' }}>
                    <Icon name="key" />
                    Abrir de novo
                  </button>
                </>
              )}
            </div>
            <span className="help">Pode fazer isso depois pelo botão “Login” da conta. Ela só aquece quando tiver login.</span>
          </>
        )}

        {step === 3 && (
          <>
            <div className="field">
              <span className="lbl">Interesses do nicho</span>
              <div className="tags">
                {tags.map((t) => (
                  <button
                    key={t}
                    className="tag-btn"
                    aria-pressed={interests.includes(t)}
                    onClick={() => setInterests(interests.includes(t) ? interests.filter((x) => x !== t) : [...interests, t])}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <input
                className="input"
                placeholder="Outro interesse e Enter"
                autoComplete="off"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && extra.trim()) {
                    e.preventDefault();
                    if (!interests.includes(extra.trim())) setInterests([...interests, extra.trim()]);
                    setExtra('');
                  }
                }}
              />
              <span className="help">O robô usa os interesses nas buscas e passa mais tempo em vídeos desses assuntos.</span>
            </div>
          </>
        )}

        <div className="modal-foot">
          {step === 1 ? (
            <button className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          )}
          {step < 3 ? (
            <button className="btn primary" onClick={next} disabled={busy}>
              {step === 1 ? (acc ? 'Continuar' : 'Criar e continuar') : login === 'done' ? 'Continuar' : 'Fazer depois'}
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              Começar aquecimento
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
