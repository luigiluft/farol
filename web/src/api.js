// FAROL - helpers de API + contexto de sessoes (A3 na F2; A4 na F4).
// fetchJson/postJson: fetch com erro tratado. HttpError carrega status+body
// (o editor usa para detectar 409 de conflito de edicao). useSSE: EventSource
// /api/events com reconnect manual (F4: aceita enabled=false para ficar
// inerte). useApi: GET com {data,error,loading,reload}.
// F4: SessionsProvider cria UM unico pipeline de sessoes (fetch seed + SSE +
// normalizacao + ordenacao) e publica {sessions,error} via Context. App monta
// o provider; Room/FlightBoard/Feed/TorreView consomem via useSessions (que
// roomData.js re-exporta daqui, mantendo os imports atuais do A3 intactos).
// Fora do provider, useSessions cai num fallback standalone identico ao
// comportamento pre-F4 (mesmo contrato { sessions, error }).
import {
  createContext, createElement, useCallback, useContext, useEffect, useRef, useState,
} from 'react';

const SSE_URL = '/api/events';
const SSE_RETRY_MS = 3000;
import { registerFleetNames } from './fleet-names.js';

const SESSIONS_URL = '/api/sessions';
const SESSIONS_STATE_RANK = { ativa: 0, ociosa: 1, dormindo: 2 };

export class HttpError extends Error {
  constructor(status, body, url) {
    super((body && body.error) || `HTTP ${status} em ${url}`);
    this.status = status;
    this.body = body || {};
  }
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new HttpError(res.status, body, url);
  }
  return res.json();
}

export async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, body, url);
  return body;
}

// Assina o SSE /api/events. onEvent recebe o payload ja parseado.
// onEvent pode mudar entre renders sem reabrir a conexao (ref).
// enabled=false nao abre conexao nenhuma (hook inerte, F4).
export function useSSE(onEvent, enabled = true) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;
    let source = null;
    let retryTimer = null;
    let closed = false;

    function connect() {
      source = new EventSource(SSE_URL);
      source.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch (err) {
          console.error('useSSE: payload invalido', err);
        }
      };
      source.onerror = () => {
        source.close();
        if (closed) return;
        retryTimer = setTimeout(connect, SSE_RETRY_MS);
      };
    }

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (source) source.close();
    };
  }, [enabled]);
}

// GET declarativo: const {data,error,loading,reload} = useApi('/api/tree')
export function useApi(path) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const lastPath = useRef(path);

  useEffect(() => {
    let alive = true;
    const pathChanged = lastPath.current !== path;
    lastPath.current = path;
    setState((prev) => ({
      data: pathChanged ? null : prev.data,
      error: null,
      loading: true,
    }));
    fetchJson(path)
      .then((data) => {
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (alive) setState({ data: null, error, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// Aceita o shape fuzzy [{title,path,score}] e shapes do recall semantico
// (path|file|id; {results:[...]}) sem quebrar se a rota mudar de formato.
// Compartilhado entre a busca da sidebar (App) e a command palette.
export function normalizeSearchResults(data) {
  const list = Array.isArray(data)
    ? data
    : data && Array.isArray(data.results)
      ? data.results
      : [];
  return list
    .map((item) => {
      if (!item) return null;
      // Semantica devolve path absoluto + vaultPath relativo (null se fora do vault).
      const path = item.vaultPath || item.path || item.file || item.id || null;
      if (typeof path !== 'string') return null;
      if (/^[a-zA-Z]:/.test(path)) return null; // fora do vault: nao abrivel na Torre
      const fallback = path.split('/').pop().replace(/\.md$/i, '');
      return {
        path,
        title: typeof item.title === 'string' && item.title ? item.title : fallback,
        score: typeof item.score === 'number' ? item.score : null,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

// ------------------------------------------------------------------
// F4: contexto de sessoes (1 fetch seed + 1 SSE para o app inteiro)
// ------------------------------------------------------------------

function sessionNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Mesma normalizacao defensiva da F3 (payloads v1/v2/v3 nao quebram a UI).
function normalizeSessionRow(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const state = SESSIONS_STATE_RANK[raw.state] !== undefined
    ? raw.state
    : (raw.active ? 'ativa' : 'ociosa');
  return {
    ...raw,
    state,
    kind: raw.kind === 'tarefa' ? 'tarefa' : 'interativa',
    tokensIn: sessionNum(raw.tokensIn),
    tokensOut: sessionNum(raw.tokensOut),
    transcriptKb: sessionNum(raw.transcriptKb),
  };
}

function prepareSessionRows(list) {
  const rows = list.map(normalizeSessionRow).filter(Boolean);
  registerFleetNames(rows); // v4: callsign() passa a devolver 'topico-N'
  return rows.sort((a, b) => {
    const ra = SESSIONS_STATE_RANK[a.state] ?? 3;
    const rb = SESSIONS_STATE_RANK[b.state] ?? 3;
    if (ra !== rb) return ra - rb;
    // lastActivityTs pode ser ISO string ou epoch: Date cobre os dois
    return new Date(b.lastActivityTs || 0) - new Date(a.lastActivityTs || 0);
  });
}

// Payload do SSE pode vir como {type:'sessions', sessions|data|payload}.
function sessionsFromEvent(ev) {
  if (!ev || typeof ev !== 'object' || ev.type !== 'sessions') return null;
  if (Array.isArray(ev.sessions)) return ev.sessions;
  if (Array.isArray(ev.data)) return ev.data;
  if (Array.isArray(ev.payload)) return ev.payload;
  return null;
}

// Pings de VAULT (SSE type 'vault', emitido pos-reindex do server): pub/sub
// minimo pro Graph refetchar ao vivo — nota nova aparece sem reload e o
// cometa do graph-fx nasce na hora. Alimentado pelo feed do provider (o
// mesmo EventSource de sessions; zero conexao extra).
const vaultSubs = new Set();

export function onVaultPing(fn) {
  if (typeof fn !== 'function') return () => {};
  vaultSubs.add(fn);
  return () => vaultSubs.delete(fn);
}

function notifyVaultPing() {
  for (const fn of vaultSubs) {
    try { fn(); } catch { /* assinante nao derruba o feed */ }
  }
}

// Pipeline real (seed + SSE). enabled=false deixa o hook 100% inerte:
// usado pelo fallback standalone quando o contexto ja cobre o componente.
function useSessionsFeed(enabled) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetchJson(SESSIONS_URL)
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        // seed nao sobrescreve dado mais novo que o SSE ja tenha trazido
        setSessions((prev) => prev || prepareSessionRows(list));
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message);
        setSessions((prev) => prev || []);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  useSSE((ev) => {
    if (ev && ev.type === 'vault') {
      notifyVaultPing();
      return;
    }
    const list = sessionsFromEvent(ev);
    if (!list) return;
    setSessions(prepareSessionRows(list));
    setError(null);
  }, enabled);

  return { sessions, error };
}

const SessionsContext = createContext(null);

// App envolve o shell inteiro: UM useSessionsFeed para o app todo.
export function SessionsProvider({ children }) {
  const value = useSessionsFeed(true);
  return createElement(SessionsContext.Provider, { value }, children);
}

// Acesso direto ao contexto (null fora do provider): titulo da aba etc.
export function useSessionsCtx() {
  return useContext(SessionsContext);
}

// Contrato historico { sessions, error }: contexto quando existe; fora do
// provider cai num pipeline standalone identico ao comportamento pre-F4.
export function useSessions() {
  const ctx = useContext(SessionsContext);
  const standalone = useSessionsFeed(ctx === null);
  return ctx === null ? standalone : ctx;
}

// ------------------------------------------------------------------
// F9: briefing de missao por sessao (sintese LLM sob demanda). Busca
// /api/briefing?id= quando aberto, com refresh periodico para acompanhar o
// agente trabalhando. Degrada silencioso: rota ausente/offline -> enabled:false
// e a UI cai na narrativa crua. id null OU enabled=false = hook inerte.
// ------------------------------------------------------------------
const BRIEFING_URL = '/api/briefing';
const BRIEFING_REFRESH_MS = 30000;

export function useBriefing(id, enabled = true) {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !id) {
      setBriefing(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    const load = () => {
      fetchJson(`${BRIEFING_URL}?id=${encodeURIComponent(id)}`)
        .then((data) => {
          if (!alive) return;
          setBriefing(data);
          setLoading(false);
        })
        .catch(() => {
          if (!alive) return;
          setBriefing({ enabled: false, error: 'briefing offline' });
          setLoading(false);
        });
    };
    load();
    const timer = setInterval(load, BRIEFING_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, enabled]);

  return { briefing, loading };
}
