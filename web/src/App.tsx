// Estrutura do painel: barra lateral, topo, avisos gerais, telas, paleta, conta nova e avisos rápidos.
import { useCallback, useEffect, useState } from 'react';
import { api, type Config } from './api.ts';
import { Icon, PlatformBadge } from './components/Icon.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { NomeAparelho } from './components/Aparelho.tsx';
import { Confirm } from './components/Confirm.tsx';
import { Palette } from './components/Palette.tsx';
import { cap, duration, hhmm } from './lib/format.ts';
import { effectiveTheme, useTheme } from './lib/theme.ts';
import { useStore, type View } from './store.tsx';
import { Ajustes } from './views/Ajustes.tsx';
import { Analises } from './views/Analises.tsx';
import { Cockpit } from './views/Cockpit.tsx';
import { Conta } from './views/Conta.tsx';
import { Proxies } from './views/Proxies.tsx';
import { Rotina } from './views/Rotina.tsx';
import { ComoUsar } from './views/ComoUsar.tsx';
import { lastSeen, Novidades } from './views/Novidades.tsx';
import { Metas } from './views/Metas.tsx';
import { Gestao } from './views/Gestao.tsx';
import { NOVIDADES } from './novidades.ts';

const NAV: [View, string, string][] = [
  ['cockpit', 'Cockpit', 'gauge'],
  ['rotina', 'Rotina', 'calendar'],
  ['proxies', 'Proxies', 'globe'],
  ['analises', 'Análises', 'chart'],
  ['metas', 'Metas personalizadas', 'flame'],
  ['ajustes', 'Ajustes', 'sliders'],
  ['ajuda', 'Como usar', 'help'],
  ['novidades', 'O que há de novo?', 'bell'],
];

const SUB: Record<View, string> = {
  cockpit: '',
  conta: '',
  rotina: 'Quando cada conta pode aquecer',
  proxies: 'Endereços de rede das contas, testados a cada 30 min',
  analises: 'Últimos 30 dias, todas as contas',
  ajustes: 'Sua conta, aparência, navegador, motor e backup',
  ajuda: 'O que cada tela faz e como o aquecimento funciona',
  novidades: 'Tudo o que mudou em cada versão do app',
  metas: 'Seus modelos de meta: prazo e números de cada fase, por sua conta e risco',
  gestao: 'Monitoramento detalhado de todos os computadores, versões e contas',
};

// Primeira vez neste navegador: um convite discreto para o "Como usar" (some ao abrir ou fechar)
const GUIDE_KEY = 'wu-guia-visto';
const guideSeen = () => {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return true;
  }
};
const markGuideSeen = () => {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    /* sem armazenamento: o convite volta na próxima vez */
  }
};

function GuideHint() {
  const { go, view } = useStore();
  const [show, setShow] = useState(() => !guideSeen());
  useEffect(() => {
    if (view === 'ajuda' && show) {
      markGuideSeen();
      setShow(false);
    }
  }, [view, show]);
  if (!show) return null;
  const close = () => (markGuideSeen(), setShow(false));
  return (
    <div className="banner">
      <Icon name="help" />
      <div className="grow">
        <b>Primeira vez aqui?</b> <span className="muted">O guia "Como usar" explica cada tela e o passo a passo para começar.</span>
      </div>
      <button className="btn sm" onClick={() => go('ajuda')}>
        Abrir o guia
      </button>
      <button className="icon-btn" onClick={close} aria-label="Fechar o convite">
        <Icon name="x" />
      </button>
    </div>
  );
}

function Side() {
  const { accounts, view, accountId, go, system, backup, motorOff, me, logout } = useStore();
  const navList: [View, string, string][] = me?.email === 'vfbnn29@gmail.com' ? [...NAV, ['gestao', 'Gestão', 'monitor']] : NAV;
  return (
    <aside className="side" aria-label="Navegação">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="flame" />
        </span>
        <span className="brand-name">
          WarmUp <span>Studio</span>
        </span>
      </div>
      <nav className="nav">
        {navList.map(([v, l, i]) => (
          <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>
            <Icon name={i} />
            <span>{l}</span>
            {v === 'novidades' && view !== 'novidades' && lastSeen() !== NOVIDADES[0].versao && (
              <span className="dot running" title="Novidades que você ainda não viu" />
            )}
          </button>
        ))}
      </nav>
      <div className="side-sec">
        <div className="eyebrow">Contas</div>
        <div className="side-accounts">
          {accounts.map((a) => (
            <button
              key={a.id}
              className="acc-link"
              onClick={() => go('conta', a.id)}
              aria-current={view === 'conta' && accountId === a.id ? 'page' : undefined}
            >
              <PlatformBadge platform={a.platform} size="xs" />
              <span className="al-name">@{a.username}</span>
              <span
                className={`dot ${a.live ? 'running' : a.attention ? (a.attention.kind === 'login' ? 'login' : 'paused') : ''}`}
                title={a.live ? 'aquecendo' : a.attention ? 'esperando você' : 'parada'}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="motor">
        <div className="motor-row">
          <span className={`dot ${motorOff ? 'paused' : 'running'}`} />
          <b>{motorOff ? 'Motor fora do ar' : 'Motor ligado'}</b>
          {!motorOff && system && <span className="mono">{duration(system.uptime)}</span>}
        </div>
        {backup && (
          <div className="dim">
            {backup.last?.at
              ? `Backup: ${new Date(backup.last.at).toLocaleDateString('pt-BR') === new Date().toLocaleDateString('pt-BR') ? `hoje às ${hhmm(backup.last.at)}` : new Date(backup.last.at).toLocaleDateString('pt-BR')}`
              : 'Backup: nenhum ainda'}
          </div>
        )}
        {system && (
          <div className="dim">
            {system.app ? 'Aplicativo do Windows' : system.pm2 ? 'Reinicia sozinho (PM2)' : 'Rodando pelo npm start'}
            {system.version ? ` · versão ${system.version}` : ''}
            {system.channel === 'teste' ? ' (teste)' : ''}
          </div>
        )}
      </div>
      <div className="side-user">
        <span className="su-email" title={me?.email}>
          {me?.email || ''}
        </span>
        <button className="icon-btn" onClick={logout} aria-label="Sair" title="Sair">
          <Icon name="logout" />
        </button>
      </div>
    </aside>
  );
}

function Banners() {
  const { config, motorOff, deviceLost, relogin, setConfig, run, reload, accounts, go } = useStore();
  const vacation = config?.pausedUntil && config.pausedUntil > Date.now();
  // Sessão parada num captcha, com a janela aberta esperando você
  const captchas = accounts.filter((a) => a.live && a.attention?.kind === 'captcha');
  return (
    <>
      {captchas.map((a) => (
        <div className="banner" role="alert" key={`captcha-${a.id}`}>
          <Icon name="bell" />
          <div className="grow">
            <b>Captcha em @{a.username}.</b>{' '}
            <span className="muted">A janela da conta está aberta na tela: resolva o captcha nela. O robô espera e continua sozinho.</span>
          </div>
          <button
            className="btn sm primary"
            onClick={() => run(() => api(`/api/accounts/${a.id}/browser`, 'POST', { purpose: 'captcha' }), 'Janela da conta na frente')}
          >
            <Icon name="window" />
            Mostrar a janela
          </button>
          <button className="btn sm" onClick={() => go('conta', a.id)}>
            Ver a conta
          </button>
        </div>
      ))}
      {deviceLost && !motorOff && (
        <div className="banner" role="alert">
          <Icon name="lock" />
          <div className="grow">
            <b>Este aparelho está sem login.</b> <span className="muted">{deviceLost} Enquanto isso, nenhuma conta aquece aqui.</span>
          </div>
          <button className="btn sm primary" onClick={relogin}>
            <Icon name="key" />
            Entrar de novo
          </button>
        </div>
      )}
      {motorOff && (
        <div className="motor-off" role="status">
          <Icon name="bolt" />
          <span>O motor está fora do ar ou reiniciando. O painel tenta de novo sozinho a cada 10 segundos.</span>
        </div>
      )}
      {vacation && (
        <div className="banner">
          <Icon name="pause" />
          <div className="grow">
            <b>Modo férias ligado.</b>{' '}
            <span className="muted">
              Nenhuma conta roda até {new Date(config!.pausedUntil!).toLocaleDateString('pt-BR')}. Elas continuam do dia em que pararam.
            </span>
          </div>
          <button
            className="btn sm"
            onClick={() =>
              run(async () => {
                setConfig(await api<Config>('/api/vacation', 'DELETE'));
                reload();
              }, 'Férias encerradas')
            }
          >
            Voltar agora
          </button>
        </div>
      )}
      {config && !config.active && !vacation && !motorOff && (
        <div className="banner">
          <Icon name="pause" />
          <div className="grow">
            <b>Piloto automático desligado.</b> <span className="muted">As contas só aquecem quando você clicar em Iniciar.</span>
          </div>
          <button
            className="btn sm"
            onClick={() =>
              run(async () => setConfig(await api<Config>('/api/config', 'POST', { active: true })), 'Piloto automático ligado')
            }
          >
            <Icon name="play" />
            Ligar
          </button>
        </div>
      )}
    </>
  );
}

export function App() {
  const store = useStore();
  const { view, accounts, accountId, config, toasts, meta, go } = store;
  const [overlay, setOverlay] = useState<'palette' | 'onboarding' | null>(null);
  const [, , toggleTheme] = useTheme();
  const close = useCallback(() => setOverlay(null), []);
  const newAccount = useCallback(() => setOverlay('onboarding'), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOverlay((o) => (o === 'palette' ? null : 'palette'));
      }
      if (e.key === 'Escape') setOverlay((o) => (o === 'palette' ? null : o));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const acc = accounts.find((a) => a.id === accountId);
  const navList: [View, string, string][] = store.me?.email === 'vfbnn29@gmail.com' ? [...NAV, ['gestao', 'Gestão', 'monitor']] : NAV;
  const title = view === 'conta' ? 'Conta' : navList.find((n) => n[0] === view)?.[1] || 'Painel';
  const now = new Date();
  const sub =
    view === 'cockpit' && config
      ? `${cap(now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }))} · Piloto automático ${config.active ? 'ligado' : 'desligado'} · Janela ${config.start}–${config.end}`
      : SUB[view];

  return (
    <div className="shell">
      <Side />
      <main className="main">
        <header className="topbar">
          <div className="title-block">
            <h1>{title}</h1>
            {view === 'conta' ? (
              <p>
                <button className="link" onClick={() => go('cockpit')}>
                  <Icon name="back" />
                  Voltar ao cockpit
                </button>
              </p>
            ) : (
              <p>{sub}</p>
            )}
          </div>
          <div className="top-actions">
            <button className="search-btn" onClick={() => setOverlay('palette')}>
              <Icon name="search" />
              <span>Buscar ou executar</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Trocar tema">
              <Icon name={effectiveTheme() === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button className="btn primary" onClick={newAccount}>
              <Icon name="plus" />
              Nova conta
            </button>
          </div>
        </header>
        <Banners />
        <GuideHint />
        {!meta ? (
          <div className="panel empty">
            <span className="spinner" />
            <p className="muted">Carregando...</p>
          </div>
        ) : view === 'ajuda' ? (
          <ComoUsar />
        ) : view === 'novidades' ? (
          <Novidades />
        ) : view === 'metas' ? (
          <Metas />
        ) : view === 'cockpit' && !accounts.length ? (
          <div className="panel empty">
            <div className="empty-art">
              <Icon name="flame" />
            </div>
            <h2>Nenhuma conta ainda</h2>
            <p className="muted">Cadastre a primeira conta. O aquecimento começa hoje e ela fica pronta no dia {meta.readyDay}.</p>
            <button className="link" onClick={() => go('ajuda')}>
              <Icon name="help" />
              Como usar
            </button>
            <button className="btn primary" onClick={newAccount}>
              <Icon name="plus" />
              Nova conta
            </button>
          </div>
        ) : (
          <>
            {view === 'cockpit' && <Cockpit />}
            {view === 'conta' && (acc || accountId) && <Conta />}
            {view === 'rotina' && <Rotina />}
            {view === 'proxies' && <Proxies />}
            {view === 'analises' && <Analises />}
            {view === 'ajustes' && <Ajustes />}
            {view === 'gestao' && store.me?.email === 'vfbnn29@gmail.com' && <Gestao />}
          </>
        )}
      </main>
      {overlay === 'palette' && <Palette onClose={close} onNewAccount={newAccount} />}
      {overlay === 'onboarding' && <Onboarding onClose={close} />}
      <NomeAparelho />
      <Confirm />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
