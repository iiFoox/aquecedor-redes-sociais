// Aparelhos: onde cada conta roda, "Rodar neste aparelho", a lista de aparelhos e os logins na nuvem (Ajustes).
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Account, type Device, type DeviceInfo, type VaultStatus } from '../api.ts';
import { useStore } from '../store.tsx';
import { when } from '../lib/format.ts';
import { Icon } from './Icon.tsx';

// Etiqueta curta no cartão da conta
export function DeviceTag({ a }: { a: Account }) {
  if (a.mine) return null;
  return (
    <div className={`dev-tag ${a.deviceId && a.deviceOnline ? '' : 'off'}`}>
      <Icon name="window" />
      {a.deviceId
        ? `roda em ${a.deviceName || 'outro aparelho'}${a.deviceOnline ? '' : ' (desligado)'}`
        : 'ainda não roda em nenhum aparelho'}
    </div>
  );
}

// Faixa na página da conta: onde ela roda e o botão para trazer para cá
export function DeviceBar({ a }: { a: Account }) {
  const { act } = useStore();
  if (a.mine)
    return (
      <div className="dev-bar here">
        <Icon name="check" />
        <span>Roda neste aparelho. A tela ao vivo e o navegador de login abrem aqui.</span>
      </div>
    );
  return (
    <div className={`dev-bar ${a.deviceId && a.deviceOnline ? '' : 'off'}`}>
      <Icon name="window" />
      <span>
        {a.deviceId ? (
          <>
            Roda em <b>{a.deviceName || 'outro aparelho'}</b>
            {a.deviceOnline ? ' (ligado)' : ' (desligado)'}. Daqui você acompanha e manda iniciar ou parar; o navegador de login abre lá.
          </>
        ) : (
          'Esta conta ainda não roda em nenhum aparelho.'
        )}
      </span>
      <button className="btn sm" onClick={() => act.claim(a)}>
        <Icon name="arrow" />
        Rodar neste aparelho
      </button>
    </div>
  );
}

// Ajustes → Aparelhos
export function Aparelhos() {
  const { run, accounts, toast } = useStore();
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [list, setList] = useState<Device[] | null>(null);
  const [name, setName] = useState('');
  const load = () => {
    api<DeviceInfo>('/api/_device')
      .then((d) => {
        setInfo(d);
        setName(d.device?.name || '');
      })
      .catch(() => {});
    api<Device[]>('/api/devices')
      .then(setList)
      .catch(() => setList([]));
  };
  useEffect(load, []);
  const rename = () =>
    run(async () => {
      await api('/api/_device', 'PUT', { name });
      load();
    }, 'Nome do aparelho salvo');
  const count = (id: string) => accounts.filter((a) => a.deviceId === id).length;
  return (
    <section className="panel">
      <h2>Aparelhos</h2>
      {info?.device ? (
        <div className="set-row">
          <div>
            <b>Este aparelho</b>
            <span>As contas cadastradas aqui rodam aqui. Dê um nome para reconhecer nos outros aparelhos.</span>
          </div>
          <div className="dev-rename">
            <input
              className="input sm"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              aria-label="Nome deste aparelho"
            />
            <button className="btn sm" onClick={() => (name.trim() ? rename() : toast('Dê um nome ao aparelho', 'bad'))}>
              Salvar
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-small">Este aparelho ainda não está ligado à sua conta. Saia e entre de novo.</p>
      )}
      {list && list.length > 0 && (
        <ul className="dev-list">
          {list.map((d) => (
            <li key={d.id}>
              <span className={`dot ${d.online ? 'running' : ''}`} />
              <b>{d.name}</b>
              {d.current && <span className="tag">este</span>}
              <span className="dim">
                {count(d.id)} conta(s) · {d.online ? 'ligado' : `visto ${when(d.lastSeen)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="help" style={{ marginTop: 10 }}>
        Cada aparelho roda as próprias contas, ao mesmo tempo. Para mudar uma conta de aparelho, abra a página dela no aparelho novo e
        clique em "Rodar neste aparelho".
      </p>
    </section>
  );
}

// Ajustes → Logins na nuvem: a chave que cifra os logins das contas no Supabase
export function LoginsNuvem() {
  const { run } = useStore();
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [mode, setMode] = useState<'atual' | 'antiga' | 'nova' | null>(null);
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [error, setError] = useState('');
  const load = () => {
    api<DeviceInfo>('/api/_device')
      .then((d) => setVault(d.vault))
      .catch(() => {});
  };
  useEffect(load, []);
  if (!vault) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (
      mode === 'nova' &&
      !confirm(
        'Começar uma chave nova? Os logins salvos com a antiga são apagados do Supabase e as contas sem pasta neste aparelho vão pedir login de novo.',
      )
    )
      return;
    await run(
      async () => {
        try {
          const r = await api<{ vault: VaultStatus }>('/auth/chave', 'POST', { acao: mode, password, oldPassword });
          setVault(r.vault);
        } catch (err) {
          setError((err as Error).message);
          throw err;
        }
        setMode(null);
        setPassword('');
        setOldPassword('');
      },
      mode === 'nova' ? 'Chave nova criada. Os logins voltam a ser salvos.' : 'Chave destrancada.',
    );
  }

  return (
    <section className="panel">
      <h2>Logins na nuvem</h2>
      <div className="set-row">
        <div>
          <b>
            {vault === 'ok' ? (
              <span className="ok-text">
                <Icon name="check" />
                Ligado
              </span>
            ) : (
              'Chave trancada'
            )}
          </b>
          <span>
            {vault === 'ok'
              ? 'O login de cada conta vai para o Supabase, cifrado com uma chave que só a sua senha abre. Conta que muda de aparelho, ou pasta que some, volta logada sozinha.'
              : 'Este aparelho não está com a chave dos logins (ela foi trocada em outro aparelho, ou a senha foi recuperada pelo e-mail). Destranque com a senha atual; se não abrir, use a senha antiga. Último caso: comece uma chave nova.'}
          </span>
        </div>
      </div>
      {vault !== 'ok' && !mode && (
        <div className="actions">
          <button className="btn sm" onClick={() => setMode('atual')}>
            <Icon name="key" />
            Destrancar com a senha atual
          </button>
          <button className="btn sm ghost" onClick={() => setMode('antiga')}>
            Tenho a senha antiga
          </button>
          <button className="btn sm ghost" onClick={() => setMode('nova')}>
            Começar chave nova
          </button>
        </div>
      )}
      {mode && (
        <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
          {mode === 'antiga' && (
            <div className="field">
              <label htmlFor="vk-antiga">Senha antiga</label>
              <input
                id="vk-antiga"
                className="input"
                type="password"
                autoComplete="off"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="vk-atual">Senha atual</label>
            <input
              id="vk-atual"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="err-box" role="alert">
              {error}
            </div>
          )}
          <div className="actions">
            <button className="btn sm" type="submit" disabled={!password || (mode === 'antiga' && !oldPassword)}>
              {mode === 'nova' ? 'Criar chave nova' : 'Destrancar'}
            </button>
            <button className="btn sm ghost" type="button" onClick={() => setMode(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// Primeira abertura neste aparelho: dar um nome para reconhecer nos outros (PC, notebook...)
export function NomeAparelho() {
  const { run } = useStore();
  const [dev, setDev] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    api<DeviceInfo>('/api/_device')
      .then((d) => {
        if (d.device && !d.device.named) {
          setDev(d.device);
          setName(d.device.name);
        }
      })
      .catch(() => {});
  }, []);
  if (!dev) return null;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    run(async () => {
      await api('/api/_device', 'PUT', { name: name.trim() });
      setDev(null);
    }, 'Aparelho com nome novo');
  };
  return (
    <div className="overlay">
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="nome-ap" onSubmit={save}>
        <h2 id="nome-ap">Como chamar este aparelho?</h2>
        <p className="muted">
          Cada aparelho roda as próprias contas. O nome aparece nos outros aparelhos para você saber onde cada conta está rodando.
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="nome-ap-in">Nome</label>
          <input
            id="nome-ap-in"
            className="input"
            value={name}
            maxLength={60}
            placeholder="PC do quarto, Notebook..."
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="modal-foot">
          <span />
          <button className="btn" type="submit" disabled={!name.trim()}>
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}
