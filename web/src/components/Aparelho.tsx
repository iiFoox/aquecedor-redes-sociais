// Aparelhos: onde cada conta roda, "Rodar neste aparelho" e a lista de aparelhos (Ajustes).
import { useEffect, useState } from 'react';
import { api, type Account, type Device, type DeviceInfo } from '../api.ts';
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
