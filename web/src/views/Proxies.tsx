// Proxies: lista com teste a cada 30 min (sem navegador), contas que usam cada um e cadastro.
import { useState } from 'react';
import { api, type Proxy } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { hhmm } from '../lib/format.ts';
import { useStore } from '../store.tsx';

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
// País e fuso do IP de saída (o navegador das contas com este proxy usa esse fuso)
const place = (p: Proxy) => (p.timezone ? ` · ${p.country ? `${p.country}, ` : ''}fuso ${p.timezone}` : '');

export function Proxies() {
  const { proxies, setProxies, run, go, toast, ask } = useStore();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const refresh = async () => setProxies(await api<Proxy[]>('/api/proxies'));
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^(https?|socks5):\/\/\S+:\d{2,5}\/?$/i.test(url.trim())) {
      setErr('Use o formato http://usuario:senha@host:porta');
      return;
    }
    setErr('');
    const p = await run(() => api<Proxy>('/api/proxies', 'POST', { url: url.trim() }), 'Proxy adicionado. Testando...');
    if (!p) return;
    setUrl('');
    await refresh();
    test(p);
  };
  const test = async (p: Proxy) => {
    setTesting(p.id);
    const r = await run(() => api<Proxy>(`/api/proxies/${p.id}/ping`, 'POST'));
    setTesting(null);
    await refresh();
    if (r)
      toast(
        r.status === 'online' ? `${host(r.url)} online: ${r.ms} ms, IP ${r.ip}${place(r)}` : `${host(r.url)} fora do ar: ${r.error}`,
        r.status === 'online' ? 'ok' : 'bad',
      );
  };
  const remove = async (p: Proxy) =>
    (await ask({ title: `Remover ${host(p.url)} da lista?`, ok: 'Remover', danger: true })) &&
    run(async () => {
      await api(`/api/proxies/${p.id}`, 'DELETE');
      await refresh();
    }, 'Proxy removido');

  const form = (
    <form className="inline-form" onSubmit={add} noValidate>
      <label className="sr" htmlFor="proxy-url">
        Endereço do proxy
      </label>
      <input
        className="input"
        id="proxy-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="http://usuario:senha@host:porta"
        autoComplete="off"
      />
      <button className="btn primary" type="submit">
        Adicionar
      </button>
      {err && <div className="form-err">{err}</div>}
    </form>
  );

  if (!proxies.length)
    return (
      <div className="panel empty">
        <div className="empty-art">
          <Icon name="globe" />
        </div>
        <h2>Nenhum proxy cadastrado</h2>
        <p className="muted">
          Hoje as contas usam a internet desta casa. Com proxies na lista, cada conta escolhe um, e o motor testa todos a cada 30 minutos,
          sem abrir o navegador. Se um proxy cair, a conta que usa ele espera ele voltar; ela nunca troca de IP sozinha.
        </p>
        {form}
      </div>
    );

  return (
    <>
      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <h2>Adicionar proxy</h2>
          <span className="muted">HTTP, HTTPS ou SOCKS5</span>
        </div>
        {form}
      </section>
      <div className="proxy-list">
        {proxies.map((p) => (
          <section key={p.id} className="panel proxy-item">
            <div className="min0">
              <span className="addr">{host(p.url)}</span>
              <span>
                {p.status === 'online' ? (
                  <span className="pill running">
                    Online · {p.ms} ms{p.ip ? ` · IP ${p.ip}` : ''}
                    {place(p)}
                  </span>
                ) : p.status === 'offline' ? (
                  <span className="pill paused">Fora do ar{p.error ? `: ${p.error}` : ''}</span>
                ) : (
                  <span className="pill">Ainda não testado</span>
                )}
              </span>
              <span className="sub">
                {p.accounts.length ? (
                  <>
                    Usado por{' '}
                    {p.accounts.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ', '}
                        <button className="who" onClick={() => go('conta', a.id)}>
                          @{a.username}
                        </button>
                      </span>
                    ))}
                  </>
                ) : (
                  'Livre: nenhuma conta usa'
                )}
                {p.lastCheck ? ` · testado às ${hhmm(p.lastCheck)}` : ''}
              </span>
            </div>
            <div className="actions">
              <button className="btn sm" onClick={() => test(p)} disabled={testing === p.id}>
                <Icon name="bolt" />
                {testing === p.id ? 'Testando...' : 'Testar agora'}
              </button>
              <button className="btn sm ghost" onClick={() => remove(p)} aria-label={`Remover ${host(p.url)}`}>
                <Icon name="trash" />
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
