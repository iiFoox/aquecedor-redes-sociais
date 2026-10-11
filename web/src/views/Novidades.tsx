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
    <div className="news">
      {NOVIDADES.map((n, i) => {
        const running = system?.version === n.versao;
        const fresh = !!seen && seen !== n.versao && NOVIDADES.findIndex((x) => x.versao === seen) > i;
        return (
          <article key={n.versao} className={`news-item${i === 0 ? ' latest' : ''}`}>
            <div className="news-when">
              <span className="news-ver mono">{n.versao}</span>
              <span className="dim">{ddmm(n.data)}</span>
            </div>
            <section className="panel news-body">
              <div className="news-head">
                <h2>{n.titulo}</h2>
                {running && <span className="pill running">{system?.channel === 'teste' ? 'Rodando aqui (teste)' : 'Rodando aqui'}</span>}
                {fresh && <span className="pill ready">Novo</span>}
              </div>
              <ul className="guide-list">
                {n.itens.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          </article>
        );
      })}
    </div>
  );
}
