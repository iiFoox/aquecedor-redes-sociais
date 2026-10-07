// Tela de login e de cadastro (arquivo à parte: quem não entrou não recebe o código do painel).
// Depois de entrar, volta para a página em que estava (o #conta/... fica no endereço).
import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from '../components/Icon.tsx';
import '../styles.css';

type Mode = 'login' | 'signup';
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

function Login() {
  const [mode, setMode] = useState<Mode>(location.pathname.startsWith('/cadastro') ? 'signup' : 'login');
  const [signupOpen, setSignupOpen] = useState(false);
  const [email, setEmail] = useState(readEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [expired] = useState(takeExpired);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // Já logado (ex.: outra aba): vai direto para o painel. Cadastro só aparece se estiver liberado neste PC.
  useEffect(() => {
    fetch('/auth/estado')
      .then((r) => r.json())
      .then((s: { logged: boolean; signup: boolean }) => {
        if (s.logged) goPanel();
        setSignupOpen(s.signup);
        if (!s.signup) setMode('login');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Foco no e-mail, ou na senha se o e-mail já veio lembrado (só ao trocar de modo)
    (mode === 'login' && email ? passRef : emailRef).current?.focus();
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
    setPassword('');
    setConfirm('');
    history.replaceState(null, '', (m === 'signup' ? '/cadastro' : '/login') + location.hash);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || lockLeft) return;
    setError('');
    if (mode === 'signup' && password !== confirm) return setError('As senhas não são iguais');
    setBusy(true);
    try {
      const r =
        mode === 'login' ? await post('/auth/login', { email, password, remember }) : await post('/auth/cadastro', { email, password });
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
          <h1>{signup ? 'Criar conta' : 'Entrar'}</h1>
          <p className="muted">
            {signup ? 'Cada usuário vê só as próprias contas do TikTok e do Instagram.' : 'Entre para ver o painel das suas contas.'}
          </p>
        </div>
        {expired && !error && (
          <div className="auth-note" role="status">
            <Icon name="lock" />
            Sua sessão expirou. Entre de novo para continuar de onde parou.
          </div>
        )}
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
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <PasswordInput
            id="senha"
            inputRef={passRef}
            value={password}
            onChange={setPassword}
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
          {signup && <span className="help">Pelo menos 10 caracteres, com letras e números. Uma frase serve.</span>}
        </div>
        {signup ? (
          <div className="field">
            <label htmlFor="confirma">Repita a senha</label>
            <PasswordInput id="confirma" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </div>
        ) : (
          <label className="auth-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Manter conectado neste aparelho por 30 dias</span>
          </label>
        )}
        {error && (
          <div className="err-box" role="alert">
            {lockLeft
              ? `Muitas tentativas. Tente de novo em ${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, '0')}.`
              : error}
          </div>
        )}
        <button className="btn primary auth-submit" type="submit" disabled={busy || !!lockLeft || !email || !password}>
          {busy ? <span className="spinner sm" aria-hidden="true" /> : <Icon name={signup ? 'plus' : 'arrow'} />}
          {busy ? (signup ? 'Criando...' : 'Entrando...') : signup ? 'Criar conta' : 'Entrar'}
        </button>
        {signupOpen && (
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
