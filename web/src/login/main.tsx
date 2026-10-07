// Tela de login, cadastro, "esqueci a senha" e senha nova (arquivo à parte: quem não entrou não recebe o código do painel).
// Depois de entrar, volta para a página em que estava (o #conta/... fica no endereço).
import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '../components/Icon.tsx';
import '../styles.css';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';
const EMAIL_KEY = 'wu-email'; // só o e-mail, para preencher da próxima vez (nunca a senha)

const readEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) || '';
  } catch {
    return '';
  }
};
const saveEmail = (e: string) => {
  try {
    localStorage.setItem(EMAIL_KEY, e);
  } catch {
    /* navegador sem armazenamento: só não lembra */
  }
};
const takeExpired = () => {
  try {
    const v = sessionStorage.getItem('wu-expired');
    sessionStorage.removeItem('wu-expired');
    return !!v;
  } catch {
    return false;
  }
};
const goPanel = () => location.replace('/' + location.hash);

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function PasswordInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input
        ref={props.inputRef}
        id={props.id}
        className="input"
        type={show ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required
        maxLength={128}
      />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Esconder a senha' : 'Mostrar a senha'}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}

// Códigos do link de "esqueci a senha" (o Supabase volta para /nova-senha#access_token=...&refresh_token=...&type=recovery)
function recoveryTokens() {
  const h = new URLSearchParams(location.hash.slice(1));
  const access_token = h.get('access_token');
  const refresh_token = h.get('refresh_token');
  const error = h.get('error_description');
  return { access_token, refresh_token, error: error ? error.replace(/\+/g, ' ') : null };
}

const TITLE: Record<Mode, [string, string]> = {
  login: ['Entrar', 'Entre para ver o painel das suas contas.'],
  signup: ['Criar conta', 'Cada usuário vê só as próprias contas do TikTok e do Instagram.'],
  forgot: ['Esqueci a senha', 'Mandamos um link para o seu e-mail. Ele abre aqui para você criar uma senha nova.'],
  reset: ['Senha nova', 'Crie a senha nova da sua conta.'],
};
const PATH: Record<Mode, string> = { login: '/login', signup: '/cadastro', forgot: '/login', reset: '/nova-senha' };

function Login() {
  const startMode: Mode = location.pathname.startsWith('/nova-senha')
    ? 'reset'
    : location.pathname.startsWith('/cadastro')
      ? 'signup'
      : 'login';
  const [mode, setMode] = useState<Mode>(startMode);
  const [recovery] = useState(recoveryTokens);
  const [signupOpen, setSignupOpen] = useState(false);
  const [email, setEmail] = useState(readEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(startMode === 'reset' && recovery.error ? `Link inválido: ${recovery.error}` : '');
  const [notice, setNotice] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [expired] = useState(takeExpired);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // Já logado (ex.: outra aba): vai direto para o painel. Cadastro só aparece se estiver liberado neste PC.
  useEffect(() => {
    if (startMode === 'reset') return;
    fetch('/auth/estado')
      .then((r) => r.json())
      .then((s: { logged: boolean; signup: boolean }) => {
        if (s.logged) goPanel();
        setSignupOpen(s.signup);
        if (!s.signup && startMode === 'signup') setMode('login');
      })
      .catch(() => {});
  }, [startMode]);

  useEffect(() => {
    // Foco no e-mail, ou na senha se o e-mail já veio lembrado (só ao trocar de modo)
    (mode === 'reset' || (mode === 'login' && email) ? passRef : emailRef).current?.focus();
  }, [mode]);

  // Contagem do bloqueio por tentativas
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setNotice('');
    setPassword('');
    setConfirm('');
    history.replaceState(null, '', PATH[m] + (m === 'reset' ? '' : location.hash.includes('access_token') ? '' : location.hash));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || lockLeft) return;
    setError('');
    setNotice('');
    if ((mode === 'signup' || mode === 'reset') && password !== confirm) return setError('As senhas não são iguais');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await post('/auth/esqueci', { email });
        if (!r.ok) return setError(r.data.error || 'Não deu para pedir agora. Tente de novo.');
        saveEmail(email.trim().toLowerCase());
        return setNotice(r.data.message);
      }
      if (mode === 'reset') {
        const r = await post('/auth/nova-senha', { access_token: recovery.access_token, refresh_token: recovery.refresh_token, password });
        if (!r.ok) return setError(r.data.error || 'Não deu para trocar a senha.');
        switchMode('login');
        return setNotice('Senha nova criada. Entre com ela.');
      }
      const r =
        mode === 'login' ? await post('/auth/login', { email, password, remember }) : await post('/auth/cadastro', { email, password });
      if (r.ok && r.data.confirm) {
        // Supabase pediu confirmação do e-mail: entra depois de clicar no link
        saveEmail(email.trim().toLowerCase());
        switchMode('login');
        return setNotice(r.data.message);
      }
      if (r.ok) {
        saveEmail(email.trim().toLowerCase());
        return goPanel();
      }
      if (r.status === 429 && r.data.retryAfter) setLockedUntil(Date.now() + r.data.retryAfter * 1000);
      setError(r.data.error || 'Não deu para entrar. Tente de novo.');
      setPassword('');
      passRef.current?.focus();
    } catch {
      setError('O painel não respondeu. Confira se o WarmUp Studio está ligado.');
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === 'signup';
  const needsPassword = mode !== 'forgot';
  const needsEmail = mode !== 'reset';
  const twoPasswords = signup || mode === 'reset';
  const [title, sub] = TITLE[mode];
  const button = {
    login: busy ? 'Entrando...' : 'Entrar',
    signup: busy ? 'Criando...' : 'Criar conta',
    forgot: busy ? 'Enviando...' : 'Enviar o link',
    reset: busy ? 'Salvando...' : 'Salvar a senha nova',
  }[mode];
  const disabled =
    busy || !!lockLeft || (needsEmail && !email) || (needsPassword && !password) || (mode === 'reset' && !recovery.access_token);
  return (
    <main className="auth">
      <form className="auth-card panel" onSubmit={submit} noValidate>
        <div className="brand auth-brand">
          <span className="brand-mark">
            <Icon name="flame" />
          </span>
          <span className="brand-name">
            WarmUp <span>Studio</span>
          </span>
        </div>
        <div>
          <h1>{title}</h1>
          <p className="muted">{sub}</p>
        </div>
        {expired && !error && !notice && (
          <div className="auth-note" role="status">
            <Icon name="lock" />
            Sua sessão expirou. Entre de novo para continuar de onde parou.
          </div>
        )}
        {notice && (
          <div className="auth-note ok" role="status">
            <Icon name="check" />
            {notice}
          </div>
        )}
        {needsEmail && (
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              ref={emailRef}
              id="email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete={signup ? 'email' : 'username'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </div>
        )}
        {needsPassword && (
          <div className="field">
            <label htmlFor="senha">{mode === 'reset' ? 'Senha nova' : 'Senha'}</label>
            <PasswordInput
              id="senha"
              inputRef={passRef}
              value={password}
              onChange={setPassword}
              autoComplete={twoPasswords ? 'new-password' : 'current-password'}
            />
            {twoPasswords && <span className="help">Pelo menos 10 caracteres, com letras e números. Uma frase serve.</span>}
          </div>
        )}
        {twoPasswords && (
          <div className="field">
            <label htmlFor="confirma">Repita a senha</label>
            <PasswordInput id="confirma" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </div>
        )}
        {mode === 'login' && (
          <div className="auth-row">
            <label className="auth-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Manter conectado por 30 dias</span>
            </label>
            <button type="button" className="link" onClick={() => switchMode('forgot')}>
              Esqueci a senha
            </button>
          </div>
        )}
        {error && (
          <div className="err-box" role="alert">
            {lockLeft
              ? `Muitas tentativas. Tente de novo em ${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, '0')}.`
              : error}
          </div>
        )}
        <button className="btn primary auth-submit" type="submit" disabled={disabled}>
          {busy ? (
            <span className="spinner sm" aria-hidden="true" />
          ) : (
            <Icon name={signup ? 'plus' : mode === 'forgot' ? 'bell' : mode === 'reset' ? 'key' : 'arrow'} />
          )}
          {button}
        </button>
        {(mode === 'forgot' || mode === 'reset') && (
          <p className="auth-switch muted">
            <button type="button" className="link" onClick={() => switchMode('login')}>
              Voltar para entrar
            </button>
          </p>
        )}
        {signupOpen && (mode === 'login' || mode === 'signup') && (
          <p className="auth-switch muted">
            {signup ? 'Já tem conta?' : 'Primeira vez aqui?'}{' '}
            <button type="button" className="link" onClick={() => switchMode(signup ? 'login' : 'signup')}>
              {signup ? 'Entrar' : 'Criar conta'}
            </button>
          </p>
        )}
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Login />
  </StrictMode>,
);
