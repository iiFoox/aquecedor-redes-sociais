// Paleta de comandos (Ctrl+K): buscar conta, ir para uma tela ou executar uma ação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Config } from '../api.ts';
import { norm } from '../lib/format.ts';
import { useTheme } from '../lib/theme.ts';
import { useStore, type View } from '../store.tsx';
import { Icon } from './Icon.tsx';

interface Cmd {
  g: string;
  label: string;
  hint?: string;
  ic: string;
  run: () => void;
}

export function Palette({ onClose, onNewAccount }: { onClose: () => void; onNewAccount: () => void }) {
  const { accounts, go, act, config, setConfig, run } = useStore();
  const [, , toggleTheme] = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);

  const cmds = useMemo(() => {
    const c: Cmd[] = [];
    for (const a of accounts) {
      c.push({ g: 'Contas', label: `@${a.username}`, hint: 'abrir página', ic: a.platform, run: () => go('conta', a.id) });
      if (a.live) c.push({ g: 'Contas', label: `Parar sessão · @${a.username}`, ic: 'stop', run: () => act.stop(a) });
      else if (a.attention?.kind === 'captcha')
        c.push({ g: 'Contas', label: `Abrir navegador (captcha) · @${a.username}`, ic: 'window', run: () => act.captcha(a) });
      else if (a.attention && a.attention.kind !== 'login')
        c.push({ g: 'Contas', label: `Liberar · @${a.username}`, ic: 'check', run: () => act.release(a) });
      else if (!a.attention) c.push({ g: 'Contas', label: `Iniciar sessão · @${a.username}`, ic: 'play', run: () => act.start(a) });
      c.push({ g: 'Contas', label: `Abrir login · @${a.username}`, ic: 'key', run: () => act.login(a) });
    }
    (
      [
        ['cockpit', 'Cockpit', 'gauge'],
        ['rotina', 'Rotina', 'calendar'],
        ['proxies', 'Proxies', 'globe'],
        ['analises', 'Análises', 'chart'],
        ['ajustes', 'Ajustes', 'sliders'],
      ] as [View, string, string][]
    ).forEach(([v, l, i]) => c.push({ g: 'Ir para', label: l, ic: i, run: () => go(v) }));
    c.push({ g: 'Ações', label: 'Nova conta', ic: 'plus', run: onNewAccount });
    if (config)
      c.push({
        g: 'Ações',
        label: config.active ? 'Desligar o piloto automático' : 'Ligar o piloto automático',
        ic: config.active ? 'pause' : 'play',
        run: () =>
          run(
            async () => setConfig(await api<Config>('/api/config', 'POST', { active: !config.active })),
            config.active ? 'Piloto automático desligado' : 'Piloto automático ligado',
          ),
      });
    c.push({ g: 'Ações', label: 'Modo férias', hint: 'pausar tudo', ic: 'pause', run: () => go('rotina') });
    c.push({ g: 'Ações', label: 'Fazer backup dos logins agora', ic: 'cloud', run: () => act.backupNow() });
    c.push({ g: 'Ações', label: 'Trocar tema', ic: 'moon', run: toggleTheme });
    c.push({ g: 'Ações', label: 'Como usar', hint: 'guia de cada tela', ic: 'help', run: () => go('ajuda') });
    return c;
  }, [accounts, go, act, config, setConfig, run, onNewAccount, toggleTheme]);

  const terms = norm(q.trim()).split(/\s+/).filter(Boolean);
  const items = cmds.filter((c) => terms.every((t) => norm(`${c.label} ${c.g} ${c.hint || ''}`).includes(t)));
  const cur = Math.min(sel, Math.max(0, items.length - 1));
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  const exec = (i: number) => {
    const c = items[i];
    if (!c) return;
    onClose();
    c.run();
  };

  let group = '';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <div className="pal-search">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel(Math.min(items.length - 1, cur + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel(Math.max(0, cur - 1));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                exec(cur);
              }
            }}
            placeholder="Buscar conta, tela ou ação"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={`pal-${cur}`}
          />
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {!items.length && <div className="pal-empty">Nada encontrado. Tente o @ de uma conta ou o nome de uma tela.</div>}
          {items.map((c, i) => {
            const head = c.g !== group ? (group = c.g) : null;
            return (
              <div key={`${c.g}-${c.label}`}>
                {head && <div className="pal-group">{head}</div>}
                <button
                  className="pal-item"
                  role="option"
                  id={`pal-${i}`}
                  aria-selected={i === cur}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => exec(i)}
                >
                  <Icon name={c.ic} />
                  <span>{c.label}</span>
                  {c.hint && <span className="hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> escolher
          </span>
          <span>
            <kbd>Enter</kbd> executar
          </span>
          <span>
            <kbd>Esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
