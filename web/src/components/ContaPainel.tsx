// Ajustes → Conta do painel: quem está logado, trocar a senha, cadastro liberado e os últimos acessos.
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Access, type Me } from '../api.ts';
import { useStore } from '../store.tsx';
import { accessLabel, deviceOf } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

function TrocarSenha() {
  const { run } = useStore();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('As senhas novas não são iguais');
    setBusy(true);
    try {
      await run(async () => {
        try {
          await api('/auth/senha', 'POST', { current, password });
        } catch (err) {
          setError((err as Error).message);
          throw err;
        }
        setCurrent('');
        setPassword('');
        setConfirm('');
      }, 'Senha trocada. Os outros aparelhos saíram do painel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
      <div className="field">
        <label htmlFor="pw-atual">Senha atual</label>
        <input
          id="pw-atual"
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pw-nova">Senha nova</label>
        <input
          id="pw-nova"
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="help">Pelo menos 10 caracteres, com letras e números.</span>
      </div>
      <div className="field">
        <label htmlFor="pw-nova2">Repita a senha nova</label>
        <input
          id="pw-nova2"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && (
        <div className="err-box" role="alert">
          {error}
        </div>
      )}
      <div>
        <button className="btn" type="submit" disabled={busy || !current || !password || !confirm}>
          <Icon name="key" />
          Trocar senha
        </button>
      </div>
    </form>
  );
}

export function ContaPainel() {
  const { me, setMe, run, logout } = useStore();
  const [access, setAccess] = useState<Access[] | null>(null);

  useEffect(() => {
    api<Access[]>('/auth/acessos')
      .then(setAccess)
      .catch(() => setAccess([]));
  }, []);

  if (!me) return null;
  const setSignup = (on: boolean) =>
    run(
      async () => {
        await api('/auth/cadastro-liberado', 'PUT', { on });
        setMe({ ...me, signup: on } as Me);
      },
      on ? 'Cadastro liberado neste PC' : 'Cadastro fechado',
    );

  return (
    <section className="panel">
      <h2>Conta do painel</h2>
      <div className="set-row">
        <div>
          <b>{me.email}</b>
          <span>
            {me.persistent ? 'Conectado neste aparelho por 30 dias.' : 'Sai quando você fechar o navegador.'} Você vê só as suas contas.
          </span>
        </div>
        <button className="btn sm" onClick={logout}>
          <Icon name="logout" />
          Sair
        </button>
      </div>
      <div className="set-row">
        <div>
          <b>Cadastro liberado</b>
          <span>Deixa criar um usuário novo pela tela de login, só neste PC. Feche quando não precisar.</span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={me.signup} onChange={(e) => setSignup(e.target.checked)} aria-label="Cadastro liberado" />
          <span />
        </label>
      </div>
      <details className="set-more">
        <summary>Trocar senha</summary>
        <TrocarSenha />
      </details>
      <h3 className="eyebrow" style={{ margin: '16px 0 8px' }}>
        Acessos
      </h3>
      {!access ? (
        <p className="empty-small">Carregando...</p>
      ) : !access.length ? (
        <p className="empty-small">Nenhum acesso registrado ainda.</p>
      ) : (
        <ul className="access-list">
          {access.map((a, i) => (
            <li key={i} className={a.ok ? '' : 'bad'}>
              <span className="mono">
                {new Date(a.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="acc-what">{accessLabel(a.reason)}</span>
              <span className="dim">
                {deviceOf(a.userAgent)} · {a.ip || 'IP desconhecido'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="help" style={{ marginTop: 10 }}>
        Esqueceu a senha? No PC, rode <code>npm run usuario -- senha {me.email}</code>.
      </p>
    </section>
  );
}
