// FAROL - camada de notificacoes (Onda 3). Faz DIFF de estados entre
// snapshots de sessao e emite eventos 'esperando' / 'terminou' -> vira toast
// in-app e, quando a aba esta oculta e ha permissao, Web Notification.
// diffSessionEvents e PURO e exportado para teste (nao muta os snapshots).
// isAwaiting/projectColor vem de roomData (fonte unica do gate awaiting);
// callsign/actionPhrase de callsigns (mesma identidade da Frota).
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAwaiting, projectColor } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';

// Config persistida: 'on' (default) liga toasts in-app; Web Notification so
// dispara com permissao do navegador. 'off' silencia tudo. O hook le isto.
const NOTIFY_KEY = 'torre.notify';

export function getNotifyPref() {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === 'off' ? 'off' : 'on';
  } catch (err) {
    return 'on'; // storage bloqueado (private mode): default ligado
  }
}

export function setNotifyPref(value) {
  const val = value === 'off' ? 'off' : 'on';
  try {
    window.localStorage.setItem(NOTIFY_KEY, val);
  } catch (err) {
    // sem storage: preferencia vive so na sessao corrente
  }
  return val;
}

const MAX_TOASTS = 4;
const STICKY_TYPE = 'esperando'; // sinal rosa: fica ate o operador clicar

// Sessao "viva" = trabalhando ou ociosa (nao dormindo). Base para detectar
// 'terminou' (saiu de viva). awaiting sempre implica viva (isAwaiting gate).
function isAlive(s) {
  return Boolean(s) && (s.state === 'ativa' || s.state === 'ociosa');
}

// Diff puro entre dois snapshots (arrays de sessao). NAO muta nada.
// prev nao-array (ex.: seed inicial null) => [] (primeiro payload = base).
// 'esperando': sessao virou awaiting viva (isAwaiting cobre o gotcha de
// encerrada tambem vir com awaiting=true, pois exige state !== 'dormindo').
// 'terminou': sessao viva virou dormindo OU sumiu do payload estando viva.
// 1 evento por sessao por transicao: a borda entre snapshots consecutivos
// ja e o anti-spam (awaiting->awaiting nao re-emite).
export function diffSessionEvents(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return [];
  const prevById = new Map();
  for (const s of prev) if (s && s.id) prevById.set(s.id, s);

  const events = [];
  const seen = new Set();
  for (const s of next) {
    if (!s || !s.id) continue;
    seen.add(s.id);
    const before = prevById.get(s.id);
    const wasAwaiting = before ? isAwaiting(before) : false;
    if (isAwaiting(s) && !wasAwaiting) {
      events.push({ type: 'esperando', id: s.id, session: s });
    } else if (isAlive(before) && s.state === 'dormindo') {
      events.push({ type: 'terminou', id: s.id, session: s });
    }
  }
  // sessao viva que sumiu do payload = terminou (usa o ultimo snapshot dela)
  for (const [id, before] of prevById) {
    if (!seen.has(id) && isAlive(before)) {
      events.push({ type: 'terminou', id, session: before });
    }
  }
  return events;
}

// ------------------------------------------------------------------
// construcao de toast + Web Notification a partir dos eventos do diff
// ------------------------------------------------------------------

let toastSeq = 0; // contador module-level: id unico de toast p/ key + dismiss

function toastMessage(s, isWait) {
  const proj = String((s && s.project) || 'sessão');
  const action = actionPhrase(s);
  if (action) return `${proj} · ${action}`;
  return isWait ? `${proj} · aguardando resposta` : `${proj} · sessão encerrada`;
}

// Evento -> toast. 'esperando' usa o sinal rosa (--ready) e nunca some sozinho;
// 'terminou' usa a cor da sessao (projectColor, mesma da baia na Frota).
function buildToast(ev) {
  const s = ev.session || {};
  const isWait = ev.type === STICKY_TYPE;
  toastSeq += 1;
  return {
    id: `${ev.type}:${ev.id}:${toastSeq}`,
    sessionId: ev.id,
    type: ev.type,
    sticky: isWait,
    color: isWait ? 'var(--ready)' : projectColor(s.project),
    callsign: callsign(ev.id),
    status: isWait ? 'esperando você' : 'terminou',
    message: toastMessage(s, isWait),
  };
}

// Dispara Web Notification SO com aba oculta + permissao concedida. Sem SW
// alguns navegadores lancam no construtor; degrada para toast in-app apenas.
function maybeWebNotify(toast) {
  if (typeof Notification === 'undefined') return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  if (Notification.permission !== 'granted') return;
  try {
    // eslint-disable-next-line no-new
    new Notification(`${toast.callsign} ${toast.status}`, {
      body: toast.message,
      tag: `${toast.type}:${toast.sessionId}`, // 1 por sessao+tipo no OS
    });
  } catch (err) {
    // navegador exige ServiceWorkerRegistration.showNotification: ignora
  }
}

// Refresh sem empilhar duplicado: remove toast antigo do mesmo sessao+tipo,
// anexa os novos e mantem os 4 mais recentes.
function appendToasts(current, incoming) {
  if (incoming.length === 0) return current;
  const keys = new Set(incoming.map((t) => `${t.sessionId}:${t.type}`));
  const kept = current.filter((t) => !keys.has(`${t.sessionId}:${t.type}`));
  return [...kept, ...incoming].slice(-MAX_TOASTS);
}

// Hook: recebe o array de sessoes (do useSessions) e devolve { toasts, dismiss }.
// Guarda o snapshot anterior num ref; o primeiro array (seed) so vira baseline,
// nunca notifica. Config 'off' atualiza o baseline mas nao emite, entao religar
// nao despeja transicoes acumuladas.
export function useSessionNotifications(sessions) {
  const [toasts, setToasts] = useState([]);
  const prevRef = useRef(null);

  useEffect(() => {
    if (!Array.isArray(sessions)) return;
    const prev = prevRef.current;
    prevRef.current = sessions;
    if (prev === null) return; // seed inicial = estado base, sem notificar
    if (getNotifyPref() === 'off') return;
    const built = diffSessionEvents(prev, sessions).map(buildToast);
    if (built.length === 0) return;
    setToasts((cur) => appendToasts(cur, built));
    built.forEach(maybeWebNotify);
  }, [sessions]);

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  return { toasts, dismiss };
}
