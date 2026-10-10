// Estado do painel: dados do motor, tempo real (SSE), ações, avisos e navegação.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  expired,
  type Account,
  type BackupStatus,
  type Config,
  type FeedEvent,
  type Me,
  type Meta,
  type Proxy,
  type StreamEvent,
  type SystemInfo,
} from './api.ts';
import { confetti } from './lib/confetti.ts';

export type View = 'cockpit' | 'conta' | 'rotina' | 'proxies' | 'analises' | 'ajustes' | 'ajuda' | 'novidades' | 'metas';
export const VIEWS: View[] = ['cockpit', 'conta', 'rotina', 'proxies', 'analises', 'ajustes', 'ajuda', 'novidades', 'metas'];

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'bad';
}

interface Store {
  me: Me | null;
  setMe: (m: Me) => void;
  logout: () => Promise<void>;
  meta: Meta | null;
  accounts: Account[];
  proxies: Proxy[];
  config: Config | null;
  system: SystemInfo | null;
  backup: BackupStatus | null;
  feed: FeedEvent[];
  motorOff: boolean;
  deviceLost: string | null; // o aparelho está sem login (motivo); "Entrar de novo" religa
  relogin: () => Promise<void>;
  view: View;
  accountId: string | null;
  flash: string | null; // card que acabou de bater a meta
  tick: number; // muda a cada mudança da conta aberta (para recarregar o detalhe)
  lastEvent: StreamEvent | null;
  go: (view: View, accountId?: string) => void;
  toast: (msg: string, kind?: 'ok' | 'bad') => void;
  toasts: Toast[];
  run: <T>(fn: () => Promise<T>, ok?: string) => Promise<T | undefined>;
  reload: () => Promise<void>;
  setConfig: (c: Config) => void;
  setProxies: (p: Proxy[]) => void;
  setBackup: (b: BackupStatus) => void;
  act: {
    start: (a: Account) => Promise<unknown>;
    stop: (a: Account) => Promise<unknown>;
    login: (a: Account) => Promise<unknown>;
    captcha: (a: Account) => Promise<unknown>;
    closeBrowser: (a: Account) => Promise<unknown>;
    release: (a: Account) => Promise<unknown>;
    patch: (a: Account, body: Record<string, unknown>, ok?: string) => Promise<unknown>;
    remove: (a: Account) => Promise<unknown>;
    backupNow: () => Promise<unknown>;
    claim: (a: Account) => Promise<unknown>;
  };
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora do StoreProvider');
  return s;
};

// "#conta/<id>", "#rotina"... (sobrevive ao recarregar a página)
function readHash(): { view: View; accountId: string | null } {
  const [v, id] = location.hash.slice(1).split('/');
  if (v === 'conta' && id) return { view: 'conta', accountId: id };
  return { view: VIEWS.includes(v as View) && v !== 'conta' ? (v as View) : 'cockpit', accountId: null };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [motorOff, setMotorOff] = useState(false);
  const [deviceLost, setDeviceLost] = useState<string | null>(null);
  const [nav, setNav] = useState(readHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [tick, setTick] = useState(0);
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const prev = useRef<Map<string, Account>>(new Map());
  const metaRef = useRef<Meta | null>(null);
  const accountsRef = useRef<Account[]>([]);
  const navRef = useRef(nav);
  navRef.current = nav;

  const toast = useCallback((msg: string, kind: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  }, []);

  const go = useCallback((view: View, accountId?: string) => {
    const next = { view, accountId: view === 'conta' ? accountId || null : null };
    setNav(next);
    try {
      history.replaceState(null, '', `#${view}${next.accountId ? `/${next.accountId}` : ''}`);
    } catch {
      /* sem histórico */
    }
    window.scrollTo({ top: 0 });
  }, []);

  // Comemora meta batida e mudança de fase (comparando com a leitura anterior)
  const celebrate = useCallback(
    (list: Account[]) => {
      for (const a of list) {
        const p = prev.current.get(a.id);
        if (!p) continue;
        if (p.dayStatus !== 'done' && a.dayStatus === 'done' && p.day === a.day) {
          setFlash(a.id);
          setTimeout(() => setFlash(null), 2500);
          toast(`@${a.username} bateu a meta de hoje`);
        }
        if (a.phase.n > p.phase.n) {
          confetti();
          toast(`@${a.username} entrou na fase ${a.phase.n}: ${a.phase.name}`);
        }
      }
      prev.current = new Map(list.map((a) => [a.id, a]));
    },
    [toast],
  );

  const loadAccounts = useCallback(async () => {
    const list = await api<Account[]>('/api/accounts');
    celebrate(list);
    accountsRef.current = list;
    setAccounts(list);
  }, [celebrate]);

  const reload = useCallback(async () => {
    try {
      const [m, p, c, s, b] = await Promise.all([
        metaRef.current ? Promise.resolve(metaRef.current) : api<Meta>('/api/meta'),
        api<Proxy[]>('/api/proxies'),
        api<Config>('/api/config'),
        api<SystemInfo>('/api/system'),
        api<BackupStatus>('/api/backup'),
      ]);
      metaRef.current = m;
      setMeta(m);
      setProxies(p);
      setConfig(c);
      setSystem(s);
      setBackup(b);
      await loadAccounts();
      setMotorOff(false);
      setDeviceLost(null);
    } catch (e) {
      if (e instanceof ApiError && e.motorOff) setMotorOff(true);
      if (e instanceof ApiError && e.needsDevice) {
        setMotorOff(false);
        setDeviceLost(e.message);
      }
    }
  }, [loadAccounts]);

  // Endereço mudado à mão (ou voltar do navegador): segue o #
  useEffect(() => {
    const on = () => setNav(readHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  // Quem está logado (e-mail no menu, Ajustes → Conta do painel)
  useEffect(() => {
    api<Me>('/auth/eu')
      .then(setMe)
      .catch(() => {});
  }, []);

  // Sair: encerra a sessão no servidor e volta para o login
  const logout = useCallback(async () => {
    try {
      await api('/auth/sair', 'POST', {});
    } catch {
      /* já estava fora */
    }
    location.replace('/login');
  }, []);

  // Entrar de novo: sai do painel e volta para o login, que entrega um login novo ao motor deste aparelho
  const relogin = useCallback(async () => {
    try {
      await api('/auth/sair', 'POST', {});
    } catch {
      /* já estava fora */
    }
    expired('religar');
  }, []);

  // Carga inicial + atualização a cada 10 s (o tempo real cobre o resto)
  useEffect(() => {
    reload();
    api<FeedEvent[]>('/api/feed')
      .then(setFeed)
      .catch(() => {});
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [reload]);

  // Tempo real
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    // Várias mudanças seguidas viram uma recarga só
    const soon = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        loadAccounts().catch(() => {});
        setTick((n) => n + 1);
      }, 400);
    };
    const connect = () => {
      es = new EventSource('/api/stream');
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) retry = setTimeout(connect, 5000);
      };
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as StreamEvent;
        setLastEvent(ev);
        const acc = accountsRef.current.find((a) => a.id === ev.id);
        if (ev.type === 'status' && acc) {
          setAccounts((list) =>
            list.map((a) =>
              a.id === ev.id && a.live
                ? { ...a, live: { ...a.live, status: String(ev.text), statusUntil: (ev.until as number) || null, statusAt: Date.now() } }
                : a,
            ),
          );
          return;
        }
        if (ev.type === 'action' && acc) {
          const k = String(ev.action);
          setAccounts((list) =>
            list.map((a) =>
              a.id === ev.id
                ? {
                    ...a,
                    today: { ...a.today, [k]: (a.today[k] || 0) + 1 },
                    live: a.live ? { ...a.live, stats: ev.stats as Record<string, number> } : a.live,
                  }
                : a,
            ),
          );
        }
        if ((ev.type === 'action' || ev.type === 'log' || ev.type === 'alert') && acc) {
          setFeed((f) =>
            [
              { ...(ev as unknown as FeedEvent), kind: ev.type as FeedEvent['kind'], username: acc.username, platform: acc.platform },
              ...f,
            ].slice(0, 80),
          );
          if (ev.type === 'action') return;
        }
        if (ev.type === 'attention' && acc && ev.attention) toast(`@${acc.username}: ${(ev.attention as { msg: string }).msg}`, 'bad');
        if (ev.type === 'backup' && ev.backup) toast(`Backup dos logins feito (${(ev.backup as { sizeMB: number }).sizeMB} MB)`);
        if (['vacation', 'backup', 'proxies', 'device-login'].includes(ev.type)) reload();
        soon();
      };
    };
    connect();
    return () => {
      if (es) es.close();
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
    };
  }, [loadAccounts, reload, toast]);

  // Executa uma ação: mostra o erro do motor como aviso, recarrega as contas depois
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string) => {
      try {
        const r = await fn();
        // Conta de outro aparelho: a ação vira pedido para ele (a resposta diz para onde foi)
        const q = r as { queued?: boolean; message?: string } | undefined;
        if (q && q.queued && q.message) toast(q.message);
        else if (ok) toast(ok);
        loadAccounts().catch(() => {});
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'bad');
        return undefined;
      }
    },
    [toast, loadAccounts],
  );

  const act = useMemo(
    () => ({
      start: (a: Account) => run(() => api(`/api/accounts/${a.id}/start`, 'POST'), `Sessão da @${a.username} iniciando`),
      stop: (a: Account) => run(() => api(`/api/accounts/${a.id}/stop`, 'POST'), `Encerrando a sessão da @${a.username} com segurança`),
      login: (a: Account) =>
        run(
          () => api(`/api/accounts/${a.id}/login`, 'POST'),
          'Janela de login aberta no PC. Ela fecha sozinha quando o login for detectado.',
        ),
      captcha: (a: Account) =>
        run(
          () => api(`/api/accounts/${a.id}/browser`, 'POST', { purpose: 'captcha' }),
          'Navegador aberto no PC. Resolva o captcha e feche a janela; a conta volta para a fila.',
        ),
      closeBrowser: (a: Account) => run(() => api(`/api/accounts/${a.id}/browser/close`, 'POST')),
      release: (a: Account) =>
        run(() => api(`/api/accounts/${a.id}/release`, 'POST'), `@${a.username} liberada. Volta na próxima janela dela.`),
      patch: (a: Account, body: Record<string, unknown>, ok?: string) =>
        run(async () => {
          const r = await api(`/api/accounts/${a.id}`, 'PATCH', body);
          setProxies(await api<Proxy[]>('/api/proxies'));
          setTick((n) => n + 1);
          return r;
        }, ok),
      remove: (a: Account) =>
        run(async () => {
          const r = await api(`/api/accounts/${a.id}`, 'DELETE');
          go('cockpit');
          return r;
        }, `@${a.username} removida`),
      backupNow: () =>
        run(async () => {
          setBackup(await api<BackupStatus>('/api/backup', 'POST'));
        }, 'Backup dos logins feito'),
      claim: (a: Account) => run(() => api(`/api/accounts/${a.id}/claim`, 'POST'), `@${a.username} agora roda neste aparelho`),
    }),
    [run, go],
  );

  const value: Store = {
    me,
    setMe,
    logout,
    relogin,
    deviceLost,
    meta,
    accounts,
    proxies,
    config,
    system,
    backup,
    feed,
    motorOff,
    view: nav.view,
    accountId: nav.accountId,
    flash,
    tick,
    lastEvent,
    go,
    toast,
    toasts,
    run,
    reload,
    setConfig,
    setProxies,
    setBackup,
    act,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
