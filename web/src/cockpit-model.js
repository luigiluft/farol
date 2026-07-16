// FAROL - cockpit-model: helpers PUROS do Cockpit v2 (sem React) — cor,
// formatos, classificador de dominio, selo de frescor do olho, plano de
// artefato ("o que a sessao processa") e agrupamento do espelho por turno.
// Puro de proposito: scripts/checks/check-cockpit-model.mjs roda em node.

const PALETTE = [
  '#3ddc84', '#ffb454', '#82aaff', '#ff6b9d', '#4dd0e1', '#c792ea', '#ff8a65',
  '#7cd992', '#f48fb1', '#64b5f6', '#ffd54f', '#4db6ac', '#e57373', '#9575cd',
];

export function idColor(id) {
  const s = String(id || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[(h >>> 0) % PALETTE.length];
}

export function initials(name) {
  return String(name || '').slice(0, 2).toUpperCase();
}

export function fmtTok(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return Math.round(v / 1e3) + 'k';
  return String(v);
}

export function fmtDur(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m < 60) return m + 'min';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
}

export function fmtAge(sec) {
  const v = Math.max(0, Math.round(Number(sec) || 0));
  if (v < 60) return v + 's';
  if (v < 3600) return Math.floor(v / 60) + 'min';
  if (v < 86400) return Math.floor(v / 3600) + 'h';
  return Math.floor(v / 86400) + 'd';
}

export function fmtClock(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

export function fmtDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1);
}

// ------------------------------------------------------------- dominio ----
export const DOMAINS = {
  web: { key: 'web', label: 'web', color: '#4dd0e1' },
  granola: { key: 'granola', label: 'granola', color: '#7cd992' },
  gmail: { key: 'gmail', label: 'gmail', color: '#e57373' },
  vault: { key: 'vault', label: 'vault', color: '#c792ea' },
  codigo: { key: 'codigo', label: 'código', color: '#82aaff' },
  build: { key: 'build', label: 'build', color: '#ff8a65' },
  busca: { key: 'busca', label: 'busca', color: '#ffd54f' },
  mcp: { key: 'mcp', label: 'mcp', color: '#ff8a65' },
};

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read']);
const CMD_TOOLS = new Set(['Bash', 'PowerShell']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch']);
const BUILD_RE = /\b(npm run build|npm test|vite build|tsc|npm ci|npm install)\b/;
const BROWSER_RE = /claude-in-chrome|playwright|browser/i;
const NAV_TOOL_RE = /__(navigate|tabs_create_mcp)$|browser_navigate$/;

// Acao roda num navegador? (tool OU mcpServer batem no perfil de browser)
export function isBrowserAction(a) {
  if (!a) return false;
  return BROWSER_RE.test(String(a.tool || '')) || BROWSER_RE.test(String(a.mcpServer || ''));
}

// Ultima navegacao REAL da sessao ({host, ts}). recentActions guardam so o
// target (host); a URL cheia vive apenas na currentAction do navigate.
export function lastNavOf(session) {
  const acts = Array.isArray(session && session.recentActions) ? session.recentActions : [];
  for (let i = acts.length - 1; i >= 0; i -= 1) {
    const a = acts[i];
    if (a && NAV_TOOL_RE.test(String(a.tool || '')) && a.target) {
      return { host: String(a.target), ts: a.ts || null };
    }
  }
  return null;
}

// Frame historico foi SUPERADO por navegacao mais nova? Um print de pagina
// que a sessao ja deixou nao pode ser protagonista do palco.
export function webSupersedesFrame(plan, lastFrame) {
  if (!plan || plan.mode !== 'web' || !plan.navTs) return false;
  const nav = Date.parse(plan.navTs);
  if (!Number.isFinite(nav)) return false;
  const fr = lastFrame ? Date.parse(lastFrame.ts || '') : NaN;
  return !Number.isFinite(fr) || nav > fr;
}

function domainOfAction(a) {
  if (!a || !a.tool) return null;
  const t = String(a.tool);
  const srv = a.mcpServer ? String(a.mcpServer) : '';
  if (/granola/i.test(srv)) return DOMAINS.granola;
  if (/gmail/i.test(srv)) return DOMAINS.gmail;
  if (BROWSER_RE.test(srv) || BROWSER_RE.test(t)) return DOMAINS.web;
  if (t.startsWith('mcp__')) return DOMAINS.mcp;
  if (a.vaultPath) return DOMAINS.vault;
  if (CMD_TOOLS.has(t)) return BUILD_RE.test(String(a.target || '')) ? DOMAINS.build : DOMAINS.codigo;
  if (FILE_TOOLS.has(t)) return DOMAINS.codigo;
  if (SEARCH_TOOLS.has(t)) return DOMAINS.busca;
  return null;
}

// Dominio da sessao: acoes recentes votam, empate decide pela MAIS RECENTE.
export function domainOf(session) {
  const acts = Array.isArray(session && session.recentActions) ? session.recentActions : [];
  const votes = new Map();
  let latest = null;
  for (const a of acts) {
    const d = domainOfAction(a);
    if (!d) continue;
    votes.set(d.key, (votes.get(d.key) || 0) + 1);
    latest = d;
  }
  if (!votes.size) return DOMAINS.codigo;
  let best = null;
  let bestN = 0;
  for (const [key, n] of votes) {
    if (n > bestN || (n === bestN && latest && key === latest.key)) {
      best = key;
      bestN = n;
    }
  }
  return DOMAINS[best] || DOMAINS.codigo;
}

// ---------------------------------------------------------------- selo ----
const FRESH_S = 120;
const WARM_S = 900;

export function seloOf({ frames, liveOn, now }) {
  if (liveOn) return { cls: 'live', label: 'AO VIVO' };
  const list = Array.isArray(frames) ? frames : [];
  const last = list.length ? list[list.length - 1] : null;
  const ts = last ? Date.parse(last.ts || '') : NaN;
  if (!Number.isFinite(ts)) return { cls: 'never', label: 'NUNCA VIU TELA' };
  const sec = Math.max(0, ((now || Date.now()) - ts) / 1000);
  const cls = sec < FRESH_S ? 'fresh' : sec < WARM_S ? 'warm' : 'cold';
  return { cls, label: 'VIU HÁ ' + fmtAge(sec), ageSec: sec };
}

// ------------------------------------------------------ plano do olho -----
// Decide O QUE o olho mostra quando nao ha frame fresco, a partir da acao
// corrente REAL. dir so quando o alvo parece listagem/glob de diretorio.
export function artifactPlanOf(session) {
  const s = session || {};
  if (s.awaitingInput === true && s.state !== 'dormindo' && s.pendingQuestion) {
    return { mode: 'question' };
  }
  const a = s.currentAction || null;
  const tool = a && a.tool ? String(a.tool) : '';
  const raw = a && a.detail ? String(a.detail) : (a && a.target ? String(a.target) : '');
  if (isBrowserAction(a)) {
    const nav = lastNavOf(s);
    const url = NAV_TOOL_RE.test(tool) && /^https?:/i.test(raw) ? raw : null;
    const host = (nav && nav.host)
      || (NAV_TOOL_RE.test(tool) && a.target ? String(a.target) : null);
    return { mode: 'web', url, host, navTs: nav ? nav.ts : (a.ts || null) };
  }
  if (FILE_TOOLS.has(tool) && raw) {
    return { mode: 'file', path: raw, line: null };
  }
  if ((tool === 'Glob' || CMD_TOOLS.has(tool)) && /(^|\s)ls\s|[\\/]\*\*?$|[\\/]$/.test(raw)) {
    const m = raw.match(/["']?([A-Za-z]:[\\/][^"'\s*]+|~[\\/][^"'\s*]+)/);
    if (m) return { mode: 'dir', path: m[1] };
  }
  if (CMD_TOOLS.has(tool)) return { mode: 'output', cmd: raw };
  if (tool === 'Grep' || tool === 'Glob') return { mode: 'search', pattern: raw };
  return { mode: 'none' };
}

// ------------------------------------------------------------- turnos -----
// lines = saida do mapMirrorLine ({kind,time,text,seq}). Agrupa por prompt
// do usuario; rajadas tool/result viram um item 'acts' (colapsavel).
export function groupTurns(lines) {
  const blocks = [];
  let cur = null;
  let run = null;
  const flushRun = () => {
    if (run && run.list.length) cur.items.push(run);
    run = null;
  };
  const push = () => {
    if (!cur) return;
    flushRun();
    blocks.push(cur);
  };
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l) continue;
    if (l.kind === 'user') {
      push();
      cur = { user: l, items: [] };
      continue;
    }
    if (!cur) cur = { user: null, items: [] };
    if (l.kind === 'tool' || l.kind === 'result') {
      if (!run) run = { kind: 'acts', list: [] };
      run.list.push(l);
    } else {
      flushRun();
      cur.items.push({ kind: 'prose', line: l });
    }
  }
  push();
  return blocks;
}

// Resumo de um grupo de acoes: "6 ações — 3× editando · 2× executando".
export function actsSummary(list) {
  const verbs = new Map();
  for (const l of list) {
    if (l.kind !== 'tool') continue;
    const v = String(l.text || '').split(' ')[0] || 'rodando';
    verbs.set(v, (verbs.get(v) || 0) + 1);
  }
  const parts = [...verbs.entries()].map(([v, n]) => n + '× ' + v);
  return list.length + ' ações' + (parts.length ? ' — ' + parts.join(' · ') : '');
}

// Primeira frase util de um texto (ate ./!/? ou fim), limpando marcadores de
// markdown/lista pra a linha do digest ler limpa; cap n chars com reticencia.
export function firstSentence(text, n = 160) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/[*_`#>]/g, '').replace(/^\s*[-•]\s*/, '').trim();
  if (!s) return '';
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  let out = m ? m[1] : s;
  if (out.length > n) out = out.slice(0, n - 1).trimEnd() + '…';
  return out;
}

// Digest de um turno (rumo A "resultado-primeiro"): a linha de RESULTADO e a
// ULTIMA prosa do assistant no turno (a conclusao), como 1a frase limpa; mais o
// resumo das acoes SOMADAS do turno. hasBody diz se ha o que expandir no "abrir".
export function turnDigest(block) {
  const items = block && Array.isArray(block.items) ? block.items : [];
  const proses = items.filter((it) => it && it.kind === 'prose' && it.line);
  const actGroups = items.filter((it) => it && it.kind === 'acts');
  const lastProse = proses.length ? proses[proses.length - 1].line.text : '';
  const allActs = actGroups.flatMap((a) => (Array.isArray(a.list) ? a.list : []));
  return {
    result: firstSentence(lastProse, 160),
    actsSum: allActs.length ? actsSummary(allActs) : '',
    hasBody: proses.length > 0 || allActs.length > 0,
  };
}

// ------------------------------------------------- parede v3: estado ------
// Estado da sessao pra parede em faixas. Fonte: awaiting + state do servidor.
// wait tem prioridade (o que precisa de voce); dormindo depois; ativa =
// trabalhando; ociosa = parada mas viva.
export function wallStateOf(session) {
  const s = session || {};
  if (s.awaitingInput === true && s.state !== 'dormindo') return 'wait';
  if (s.state === 'dormindo') return 'sleep';
  if (s.state === 'ativa') return 'work';
  return 'idle';
}

// Contexto da sessao em % da janela do modelo (200k / 1M). null quando o
// payload ainda nao registrou contexto. hot >= 70 (avisa antes do compact).
export function ctxPctOf(session) {
  const s = session || {};
  const used = Number(s.contextTokens);
  const lim = Number(s.contextLimit);
  if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(lim) || lim <= 0) return null;
  return Math.min(100, Math.round((used / lim) * 100));
}

// Progresso de fases (TodoWrite). null quando a sessao nao declarou tasks.
export function phaseOf(session) {
  const list = Array.isArray(session && session.tasks) ? session.tasks : [];
  if (!list.length) return null;
  const done = list.filter((t) => t && t.status === 'completed').length;
  return { done, total: list.length };
}

// Agrupa a parede em ate 3 faixas visiveis (decisao: lanes). Ordem dentro da
// faixa: esperando pela espera MAIS LONGA no topo (lastActivityTs asc); as
// demais pela atividade mais recente; em 'paradas', ociosa antes de dormindo.
// Faixa sem sessao nao aparece.
const LANE_DEFS = [
  { key: 'wait', label: 'precisa de você', tone: 'wait', states: ['wait'] },
  { key: 'work', label: 'trabalhando', tone: 'work', states: ['work'] },
  { key: 'parked', label: 'paradas', tone: 'sleep', states: ['idle', 'sleep'] },
];

function activityMs(s) {
  const t = Date.parse((s && s.lastActivityTs) || '');
  return Number.isFinite(t) ? t : 0;
}

export function laneGroups(sessions) {
  const list = Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [];
  const byState = new Map();
  for (const s of list) {
    const st = wallStateOf(s);
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(s);
  }
  const lanes = [];
  for (const def of LANE_DEFS) {
    const items = [];
    for (const st of def.states) {
      const arr = byState.get(st);
      if (arr) items.push(...arr);
    }
    if (!items.length) continue;
    if (def.key === 'wait') {
      items.sort((a, b) => activityMs(a) - activityMs(b));
    } else if (def.key === 'parked') {
      const rank = (s) => (wallStateOf(s) === 'idle' ? 0 : 1);
      items.sort((a, b) => rank(a) - rank(b) || activityMs(b) - activityMs(a));
    } else {
      items.sort((a, b) => activityMs(b) - activityMs(a));
    }
    lanes.push({ key: def.key, label: def.label, tone: def.tone, sessions: items });
  }
  return lanes;
}

// ----------------------------------------------------- assets no cockpit ----
// Task cockpit-assets: ledger unificado, camadas do palco e thumbs.

const BORN_MAX_S = 600; // gen "recém-nascida" por até 10min
const DEDUPE_WINDOW_MS = 90_000;
const APM_WINDOW_MS = 5 * 60_000;
const GEN_JOB_RE = /^mcp__higgsfield__(generate_|job_status)/;

function baseName(p) {
  const parts = String(p || '').replaceAll('\\', '/').split('/');
  return parts[parts.length - 1] || '';
}

export function thumbSrcOf(gen) {
  const g = gen || {};
  return g.local || g.thumb || g.url || '';
}

// Proveniencia de um item da galeria: DE ONDE a midia veio, nao o formato.
// gen (Higgsfield) = a IA criou; frame = classificado pelo verb do visor
// (voce colou / leu de arquivo / navegou / screenshot). key agrupa pro filtro,
// label e o rotulo do badge, cls dita a cor. Puro (check-cockpit-model).
const FRAME_PROV = {
  'você enviou': { key: 'enviada', label: 'VOCÊ ENVIOU', cls: 'sent' },
  'leu imagem': { key: 'lida', label: 'LEU ARQUIVO', cls: 'read' },
  'navegou (Chrome)': { key: 'vista', label: 'NAVEGOU', cls: 'seen' },
  'screenshot (Playwright)': { key: 'vista', label: 'SCREENSHOT', cls: 'seen' },
  'capturou a tela': { key: 'vista', label: 'CAPTUROU', cls: 'seen' },
  'snapshot da janela': { key: 'vista', label: 'SNAPSHOT', cls: 'seen' },
  'preview Lovable': { key: 'vista', label: 'PREVIEW', cls: 'seen' },
  'consultou MCP': { key: 'vista', label: 'CONSULTOU', cls: 'seen' },
};

export function provenanceOf(item) {
  const it = item || {};
  if (it.kind === 'gen') {
    return { key: 'gerada', label: it.type === 'video' ? 'GERADO' : 'GERADA', cls: 'gen' };
  }
  return FRAME_PROV[String(it.verb || '')] || { key: 'vista', label: 'VISTA', cls: 'seen' };
}

// Origem legivel de um item: o que a IA pediu (prompt da geracao) ou de onde a
// tela veio (nome do arquivo / host da URL). Alimenta a linha 1 do card.
export function originLabel(item) {
  const it = item || {};
  const raw = String(it.sub || '').trim();
  if (it.kind === 'gen') return raw ? raw.slice(0, 90) : (it.title || 'geração');
  if (!raw) return it.title || 'tela';
  if (/^https?:\/\//i.test(raw)) {
    try { return new URL(raw).hostname; } catch { return raw.slice(0, 60); }
  }
  const base = raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || raw;
  return base.slice(0, 60);
}

// Timeline única da sessão: eventos do ledger + frames do visor + gens dos
// assets, DESC. Read de imagem que virou frame = 1 linha só (o frame carrega
// a mídia; o evento cru do Read sai).
export function mergeLedger(events, frames, gens) {
  const fr = Array.isArray(frames) ? frames : [];
  const frameKeys = fr.map((f) => ({ base: baseName(f.target), ts: Number(f.ts) || Date.parse(f.ts || '') || 0 }));
  const isDupe = (e) => {
    if (e.cat !== 'viu') return false;
    const base = baseName(e.target);
    if (!base) return false;
    return frameKeys.some((k) => k.base === base && Math.abs(k.ts - e.ts) <= DEDUPE_WINDOW_MS);
  };
  const rows = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || isDupe(e)) continue;
    rows.push({ ...e, media: null });
  }
  for (const f of fr) {
    const ts = Number(f.ts) || Date.parse(f.ts || '') || 0;
    rows.push({
      ts, cat: 'viu', verb: f.verb || 'viu tela', target: f.target || '', tool: 'visor',
      media: { kind: 'frame', src: f.src, full: f.src, video: null, cap: f.target || f.verb || '' },
    });
  }
  for (const g of Array.isArray(gens) ? gens : []) {
    if (!g || (!g.url && !g.thumb && !g.local)) continue;
    rows.push({
      ts: Number(g.ts) || 0, cat: 'criou', verb: 'nasceu asset', tool: 'higgsfield',
      target: [g.type, g.model].filter(Boolean).join(' · '),
      media: {
        kind: 'gen', src: thumbSrcOf(g), full: g.url || thumbSrcOf(g),
        video: g.type === 'video' ? g.url : null, cap: String(g.prompt || '').slice(0, 80), gen: g,
      },
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}

// Gen recém-completada que merece o palco: com mídia, idade < 10min e mais
// nova que o último frame (print antigo nunca cobre um nascimento).
export function bornOf(gens, frames, now) {
  const list = (Array.isArray(gens) ? gens : [])
    .filter((g) => g && (g.url || g.thumb || g.local) && g.status !== 'pending');
  if (!list.length) return null;
  const newest = list.reduce((a, b) => ((b.ts || 0) > (a.ts || 0) ? b : a));
  const age = ((now || Date.now()) - (newest.ts || 0)) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > BORN_MAX_S) return null;
  const fr = Array.isArray(frames) ? frames : [];
  const lastFrame = fr.length ? fr[fr.length - 1] : null;
  const frTs = lastFrame ? (Number(lastFrame.ts) || Date.parse(lastFrame.ts || '') || 0) : 0;
  if (frTs >= (newest.ts || 0)) return null;
  return { gen: newest, ageSec: Math.round(age) };
}

// Job de geração vivo: ação higgsfield generate/job_status mais recente sem
// gen completada DEPOIS dela (se nasceu, o born assume).
export function genJobOf(session, gens, now) {
  const acts = Array.isArray(session && session.recentActions) ? session.recentActions.slice() : [];
  const cur = session && session.currentAction;
  if (cur) acts.push(cur);
  let last = null;
  for (const a of acts) {
    if (a && GEN_JOB_RE.test(String(a.tool || ''))) last = a;
  }
  if (!last) return null;
  const sinceTs = Date.parse(last.ts || '') || (now || Date.now());
  const bornAfter = (Array.isArray(gens) ? gens : [])
    .some((g) => g && (g.url || g.thumb) && (g.ts || 0) >= sinceTs);
  if (bornAfter) return null;
  return { label: String(last.target || 'gerando'), sinceTs };
}

// Ritmo: ações dos últimos 5min normalizadas por minuto.
export function actionsPerMin(session, now) {
  const acts = Array.isArray(session && session.recentActions) ? session.recentActions : [];
  const cutoff = (now || Date.now()) - APM_WINDOW_MS;
  const n = acts.filter((a) => {
    const t = Date.parse((a && a.ts) || '');
    return Number.isFinite(t) && t >= cutoff;
  }).length;
  return Math.round(n / (APM_WINDOW_MS / 60_000));
}
