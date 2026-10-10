// O que há de novo?: o histórico de atualizações do app (web/src/novidades.ts), com a versão que está rodando marcada.
import { useEffect } from 'react';
import { NOVIDADES } from '../novidades.ts';
import { ddmm } from '../lib/format.ts';
import { useStore } from '../store.tsx';

export const SEEN_KEY = 'wu-novidades-vista';
// Versão mais nova que você já viu nesta aba (marca as entradas novas)
export function lastSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) || '';
  } catch {
    return '';
  }
}

export function Novidades() {
  const { system } = useStore();
  const seen = lastSeen();
  useEffect(() => {
    try {
      localStorage.setItem(SEEN_KEY, NOVIDADES[0].versao);
    } catch {
      /* sem armazenamento: só não marca */
    }
  }, []);
  return (
    <div className="guide">
      {NOVIDADES.map((n) => {
        const running = system?.version === n.versao;
        const fresh = !!seen && seen !== n.versao && NOVIDADES.findIndex((x) => x.versao === seen) > NOVIDADES.indexOf(n);
        return (
          <section key={n.versao} className="panel">
            <div className="panel-head">
              <h2>
                Versão {n.versao}
                <span className="dim"> · {ddmm(n.data)}</span>
              </h2>
              <span>
                {running && <span className="pill running">{system?.channel === 'teste' ? 'rodando aqui (teste)' : 'rodando aqui'}</span>}
                {fresh && <span className="pill">novo</span>}
              </span>
            </div>
            <p>
              <b>{n.titulo}</b>
            </p>
            <ul className="guide-list">
              {n.itens.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
