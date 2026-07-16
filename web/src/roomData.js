// FAROL - camada de dados da Sala (A3, F3; hook de origem trocado na F4).
// Formatadores compartilhados entre Room.jsx (painel compacto), RoomScene.jsx
// (diorama full-screen), FlightBoard.jsx e Feed.jsx. Sem JSX visual aqui:
// este modulo existe para quebrar ciclos de import entre as views da sala.
// Consome o contrato Sessions v3 (currentAction/secondsSinceEvent/subagents
// com currentAction) com fallback defensivo para payloads v2/v1.
// F4 (A4): useSessions virou re-export do api.js, que publica UM pipeline
// compartilhado via SessionsContext (App monta o provider). Assinatura
// preservada: { sessions, error }. Nenhum outro contrato deste modulo mudou.
export { useSessions } from './api.js';

export const STATE_RANK = { ativa: 0, ociosa: 1, dormindo: 2 };

export const TOKEN_LOG_FULL = 6; // 10^6 tokens out = barra cheia

// Paleta de 8 acentos: hash do nome do projeto -> cor estavel da baia.
// Sem rosa: #ff5fa2 e familia sao COR-SINAL exclusiva de "esperando voce"
// (slot 3 era #ff6e9c e colidia com o sinal; virou aco neutro).
export const PROJECT_PALETTE = [
  '#3ddc84', '#4dd0e1', '#ffb454', '#93a8c7',
  '#b48cfa', '#5ea2ff', '#c8e64c', '#ff8a5c',
];

export function projectColor(name) {
  const s = String(name || 'sessao');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// v5 segmentacao da Sala: chave da SALA de um agente. Projetos de marca conhecida
// (projetos de marca conhecida) mantem a sala tematica por marca; sessoes
// genericas ('home'/'sessao') se separam pela PASTA/repo do trabalho ATUAL
// (derivada do path da acao) -> agentes mexendo em coisas diferentes nao
// amontoam na mesma sala. Sem path (ex.: tarefa de Agent so com prompt) cai em
// 'home'. Heuristica de path: especiais conhecidos (.claude/vault/temp/desktop)
// + 1o segmento sob /users/<user>/, com pasta-pai como ultimo recurso.
const GENERIC_PROJECTS = new Set(['home', 'sessao', 'sessão', '']);

function stripDiacritics(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function workspaceFromPath(s) {
  const a = (s && s.currentAction) || {};
  const raw = a.vaultPath || a.detail || '';
  const p = stripDiacritics(String(raw)).replace(/\\/g, '/').toLowerCase();
  if (!p.includes('/')) return null; // sem path real (prompt de Agent etc.)
  if (p.includes('obsidian vault')) return 'vault';
  if (p.includes('/.claude')) return '.claude';
  if (p.includes('appdata/local/temp') || p.includes('/temp/claude')) return 'temp';
  if (p.includes('/desktop') || p.includes('area de trabalho')) return 'desktop';
  const m = p.match(/\/users\/[^/]+\/([^/]+)/);
  if (m && m[1]) return m[1];
  const segs = p.split('/').filter(Boolean);
  return segs.length >= 2 ? segs[segs.length - 2] : null;
}

export function workspaceOf(s) {
  if (!s) return 'home';
  const project = String(s.project || '').trim();
  if (!GENERIC_PROJECTS.has(project.toLowerCase())) return project; // empresa -> sala tematica
  return workspaceFromPath(s) || 'home';
}

// Payload do SSE pode vir como {type:'sessions', sessions|data|payload}.
export function extractSessions(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (Array.isArray(ev.sessions)) return ev.sessions;
  if (Array.isArray(ev.data)) return ev.data;
  if (Array.isArray(ev.payload)) return ev.payload;
  return null;
}

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Se state ausente (server v1), deriva do boolean active antigo.
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const state = STATE_RANK[raw.state] !== undefined
    ? raw.state
    : (raw.active ? 'ativa' : 'ociosa');
  return {
    ...raw,
    state,
    kind: raw.kind === 'tarefa' ? 'tarefa' : 'interativa',
    tokensIn: numOrNull(raw.tokensIn),
    tokensOut: numOrNull(raw.tokensOut),
    contextTokens: numOrNull(raw.contextTokens),
    transcriptKb: numOrNull(raw.transcriptKb),
  };
}

// ------------------------------------------------------------------
// formatadores compartilhados
// ------------------------------------------------------------------

export function shortModel(model) {
  if (!model) return 'n/d';
  const m = String(model).toLowerCase();
  const fam = m.match(/(fable|opus|sonnet|haiku)[-_]?(\d+(?:[-.]\d+)?)?/);
  if (!fam) return m.replace(/^claude-/, '').slice(0, 12);
  const ver = fam[2] ? fam[2].replace('-', '.') : '';
  return ver ? `${fam[1]}-${ver}` : fam[1];
}

function trimNum(v) {
  const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1);
  return s.replace(/\.0$/, '');
}

export function fmtTokens(n) {
  if (n === null || n === undefined) return '--';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${trimNum(n / 1000)}k`;
  return `${trimNum(n / 1e6)}M`;
}

export function flightCode(id) {
  const s = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
  return (s.slice(0, 4) || '----').toUpperCase();
}

const PLATE_MAX_CHARS = 12;

export function plateName(project) {
  const name = String(project || 'sessao');
  return name.length > PLATE_MAX_CHARS ? name.slice(0, PLATE_MAX_CHARS) : name;
}

// F8: turno encerrado (server: ultima mensagem assistant = end_turn) e nao
// dormindo => o agente parou e aguarda. Interativa = "esperando voce";
// tarefa one-shot = "concluido". Gate por state: dormindo (>30min) nao
// alerta (sinal velho); ativa/ociosa com awaiting sim.
export function isAwaiting(s) {
  return Boolean(s && s.awaitingInput) && s.state !== 'dormindo';
}

// F8: contagem coerente com os estados visiveis. 'trabalhando' = ativa e
// NAO esperando (antes contava awaiting-ativa como trabalhando, dai o "2
// trabalhando" com 1 realmente em acao). waiting = isAwaiting; total = janela.
export function agentCounts(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  let working = 0;
  let waiting = 0;
  for (const s of list) {
    if (!s) continue;
    if (isAwaiting(s)) waiting += 1;
    else if (s.state === 'ativa') working += 1;
  }
  return { working, waiting, total: list.length };
}

// String curta pros cabecalhos: "1 trabalhando · 2 esperando" (esperando
// so quando ha). Fonte unica pra FlightBoard/telao/hangar/mobile/deck.
export function activityLabel(sessions) {
  const { working, waiting } = agentCounts(sessions);
  let s = `${working} trabalhando`;
  if (waiting > 0) s += ` · ${waiting} esperando`;
  return s;
}

// Status do painel de agentes (compartilhado com o telao do diorama).
// Labels diretos (sem metafora aeronautica): qualquer pessoa entende o
// que o agente esta fazendo sem decodificar "voo/taxi". As classes
// fb-st-* sao contrato de CSS espalhado (fleet/scene/torre) e ficam.
export function rowStatus(s) {
  if (isAwaiting(s)) {
    return s.kind === 'tarefa'
      ? { label: 'CONCLUÍDO', cls: 'fb-st-feito' }
      : { label: 'ESPERANDO VOCÊ', cls: 'fb-st-espera' };
  }
  if (s.kind === 'tarefa') return { label: 'TAREFA', cls: 'fb-st-carga' };
  if (s.state === 'ativa') return { label: 'TRABALHANDO', cls: 'fb-st-voo' };
  if (s.state === 'ociosa') return { label: 'OCIOSO', cls: 'fb-st-taxi' };
  return { label: 'DORMINDO', cls: 'fb-st-dorm' };
}

// ------------------------------------------------------------------
// contexto da sessao (janela do modelo)
// ------------------------------------------------------------------

// Limite da janela: o server manda contextLimit (deteccao sticky: ctx
// passou de 200k => 1M); fallback pelo sufixo [1m] no id do modelo.
export function contextLimitOf(s) {
  const lim = Number(s && s.contextLimit);
  if (Number.isFinite(lim) && lim > 0) return lim;
  return /\[1m\]/.test(String((s && s.model) || '')) ? 1_000_000 : 200_000;
}

// % da janela de contexto em uso (0-100) ou null sem dado.
export function contextPct(s) {
  if (!s) return null;
  const ctx = Number(s.contextTokens);
  if (!Number.isFinite(ctx) || ctx <= 0) return null;
  return Math.min(100, Math.round((ctx / contextLimitOf(s)) * 100));
}

// Texto REAL da acao corrente: "Edit > NoteView.jsx" / "Bash > npm install".
// Funciona para sessao E para subagent (mesmo shape currentAction/lastTool).
export function actionLabel(s) {
  if (!s) return null;
  const a = s.currentAction;
  if (a && a.tool) return a.target ? `${a.tool} > ${a.target}` : a.tool;
  return s.lastTool || null;
}

// Barra de tokens em escala log (0..1).
export function tokenPct(tokens) {
  if (!tokens || tokens <= 0) return 0;
  return Math.min(1, Math.log10(tokens + 1) / TOKEN_LOG_FULL);
}

// Tempo de voo vivo desde startedTs: "mm:ss" ou "h:mm:ss".
export function flightTime(startedTs, now) {
  const start = Date.parse(startedTs || '');
  if (!Number.isFinite(start)) return '--:--';
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}
