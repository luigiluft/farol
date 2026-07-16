// FAROL - host de toasts (Onda 3, notificacoes). Canto inferior-direito,
// empilha ate 4 (mais novo mais perto do canto). Cada toast leva a cor da
// sessao; o de 'esperando' e o sinal rosa e NAO auto-dismissa (fica ate
// clicar). Clique no corpo seleciona a sessao (onSelect); o X fecha. Fiado
// pelo orquestrador com { toasts, dismiss } de useSessionNotifications.
import { useEffect } from 'react';
import './toasts.css';

const AUTO_DISMISS_MS = 8000;

function ToastCard({ toast, onDismiss, onSelect }) {
  useEffect(() => {
    if (toast.sticky) return undefined; // esperando (rosa): so sai no clique
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.sticky, onDismiss]);

  function handleSelect() {
    if (onSelect) onSelect(toast.sessionId);
  }
  function handleClose(ev) {
    ev.stopPropagation();
    onDismiss(toast.id);
  }

  return (
    <li className={'toast' + (toast.sticky ? ' toast-wait' : '')} style={{ '--toast-c': toast.color }}>
      <button type="button" className="toast-main" onClick={handleSelect}>
        <span className="toast-head">
          <span className="toast-callsign">{toast.callsign}</span>
          <span className="toast-status">{toast.status}</span>
        </span>
        <span className="toast-msg">{toast.message}</span>
      </button>
      <button type="button" className="toast-close" onClick={handleClose} aria-label="Fechar">×</button>
    </li>
  );
}

export default function Toasts({ toasts, onDismiss, onSelect }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <ul className="toast-host" role="region" aria-label="Notificações" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} onSelect={onSelect} />
      ))}
    </ul>
  );
}
