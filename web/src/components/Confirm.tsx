// Pergunta na janela do próprio app (store.ask), no lugar do confirm() do navegador. Esc ou "Cancelar" = não.
import { useEffect } from 'react';
import { useStore } from '../store.tsx';

export function Confirm() {
  const { asking } = useStore();
  useEffect(() => {
    if (!asking) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && asking.answer(false);
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [asking]);
  if (!asking) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && asking.answer(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="ask-title">
        <h2 id="ask-title">{asking.title}</h2>
        {asking.body ? <div className="muted ask-body">{asking.body}</div> : null}
        <div className="modal-foot">
          <button className="btn" type="button" onClick={() => asking.answer(false)}>
            {asking.cancel || 'Cancelar'}
          </button>
          <button className={`btn ${asking.danger ? 'danger' : 'primary'}`} type="button" autoFocus onClick={() => asking.answer(true)}>
            {asking.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
