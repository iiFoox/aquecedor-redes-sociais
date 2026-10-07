// Tema: segue o sistema, ou fica fixo em claro ou escuro (guardado neste navegador).
import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const read = (): ThemePref => {
  try {
    const t = localStorage.getItem('ws-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
};

export const effectiveTheme = () =>
  (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ||
  (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

const listeners = new Set<() => void>();

export function useTheme(): [ThemePref, (t: ThemePref) => void, () => void] {
  const [pref, setPrefState] = useState<ThemePref>(read);
  useEffect(() => {
    const on = () => setPrefState(read());
    listeners.add(on);
    const mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', on);
    return () => {
      listeners.delete(on);
      mq.removeEventListener('change', on);
    };
  }, []);
  const setPref = useCallback((t: ThemePref) => {
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('ws-theme', t);
    } catch {
      /* sem armazenamento */
    }
    listeners.forEach((l) => l());
  }, []);
  const toggle = useCallback(() => setPref(effectiveTheme() === 'dark' ? 'light' : 'dark'), [setPref]);
  return [pref, setPref, toggle];
}
