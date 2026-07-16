// FAROL - modulo sessions v3 (ownership: agente A1). ADITIVO sobre v2:
// todos os campos v2 sao preservados (a UI atual depende deles).
// Le ~/.claude/projects/<proj>/<uuid>.jsonl numa janela de 4h e expoe estado
// (ativa <3min, ociosa <30min, dormindo <4h), kind (interativa|tarefa via
// heuristica de one-shot headless), tokens incrementais com cache de offset
// por arquivo (so bytes novos sao lidos; boot = tail 512KB, aproximacao ok),
// startedTs (birthtime), transcriptKb e subagents recentes.
// v3: currentAction {tool,target,detail,ts} extraida do input do ultimo
// tool_use (tabela de extracao por tool), secondsSinceEvent, recentActions
// (ultimas 10, ordem cronologica; F5 subiu de 5 para alimentar o LOG do
// cartao de missao) e currentAction em cada subagent. Tudo no
// MESMO passe de parse incremental ja existente (zero leitura extra).
// F4 (aditivo): currentAction e cada recentAction ganham vaultPath
// (string|null) = caminho RELATIVO ao vault quando o arquivo da acao resolve
// dentro de VAULT (separadores normalizados p/ '/', prefixo case-insensitive,
// casing original preservado no restante - casa com os ids do /api/graph).
// Subagents idem (mesmo buildAction).
// F5.8 (aditivo): acoes ganham mcpServer (string|null) e o modulo acumula
// mcpSeen (uso de MCP servers), exposto via getMcpSeen() para o /api/mcp.
// F7 (aditivo): skillSeen (uso da tool Skill, mesmo padrao do mcpSeen) +
// getSkillSeen(); extractor Skill em buildAction (target = input.skill);
// describeAction() exportado p/ o /api/mirror (mesma tabela de extracao,
// SEM telemetria); getSessionFile(id) p/ o espelho do terminal; subagents
// ganham agentType (meta.json); mcpSeen/skillSeen persistidos em
// torre/.data/seen.json (load no boot, write debounced 30s, merge por MAX).
// Parse defensivo linha a linha (JSON.parse com catch); rotas nunca derrubam.
// Exporta getSessions(), countActiveSessions() (<3min) e watchSessions(cb).

import fsp from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import { CLAUDE, VAULT, DATA_DIR, PROJECT_PREFIX_RE } from './config.mjs';
import { inferTopic, createFleetNamer } from './topics.mjs';

// v4 (2026-07-03): nomes LOGICOS da frota — topico-N substitui estrela como
// nome primario; numerador vive no processo do server (fonte unica).
const assignFleetNames = createFleetNamer();

const PROJECTS = path.join(CLAUDE, 'projects');
const WINDOW_MS = 4 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const ACTIVE_MS = 180 * 1000;
const SUB_RECENT_MS = 30 * 60 * 1000;
const BOOT_TAIL_BYTES = 512 * 1024;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const SUB_TAIL_BYTES = 256 * 1024;
const SUB_TAIL_LINES = 40;
const PREVIEW_LEN = 80;
const SUB_CAP = 64; // era 16 — fan-out de workflow (34+) ficava cortado
const RECENT_ACTIONS_MAX = 10;
const SUB_RECENT_ACTIONS = 6; // trail de ações por subagente (fluxo do Cockpit)
const NARRATIVE_LEN = 280; // F9: clip da prosa do agente (texto assistant)
const QUESTION_TAIL_LEN = 160; // v2: clip pelo FIM (pergunta pendente do awaiting)
const TASKS_MAX = 12; // F9: teto do checklist de missao por sessao
const PROMPT_LOG_LEN = 140; // F8: clip de cada prompt do localizador
const PROMPT_LOG_MAX = 6; // F8: ultimos N prompts reais por sessao
const CMD_TARGET_LEN = 46;
const TARGET_LEN = 40;
const DETAIL_LEN = 160;
const FILE_TOOLS = new Set(['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit']);
const CMD_TOOLS = new Set(['Bash', 'PowerShell']);
const PATTERN_TOOLS = new Set(['Grep', 'Glob']);
const TASK_LINE_MAX = 12;
const CACHE_TTL_MS = WINDOW_MS + 60 * 60 * 1000;
const WATCH_DEBOUNCE_MS = 1000;
const WATCH_DEPTH = 5;
const STATE_RANK = { ativa: 0, ociosa: 1, dormindo: 2 };
const NL = 0x0a;
// Raiz do vault normalizada uma vez (separadores '/', sem barra final) para o
// prefix match case-insensitive de vaultRelPath(). VAULT vem de config.mjs.
const VAULT_PREFIX_LC =
  VAULT.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() + '/';

// ----------------------------------------------------- cache incremental ----
// Um entry por arquivo jsonl: offset de bytes ja consumidos + acumuladores.
// Nunca relemos o arquivo inteiro: so a fatia [offset, size) de cada ciclo.

const fileCache = new Map();

function newEntry() {
  return {
    offset: 0,
    initialized: false,
    approxStart: false, // boot pulou bytes: linhas/preview sao aproximados
    lines: 0,
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0, // contexto da ULTIMA chamada (input + cache read/create)
    ctxBig: false, // contexto ja passou de 200k => janela do modelo e 1M
    model: null,
    lastTool: null,
    currentAction: null,
    recentActions: [],
    narrative: null, // F9: ultimo bloco de texto do assistant (a prosa que o agente escreve)
    narrativeTail: null, // v2: FIM do ultimo texto do assistant (a pergunta mora ali)
    tasks: [], // F9: estado da task list (Task*/TodoWrite) p/ checklist de missao
    // F8: turno encerrado = ultima linha-mensagem foi assistant end_turn/
    // stop_sequence (sem tool pendente). Linha user (humano OU tool_result)
    // zera. Meta-linhas (attachment/pr-link/permission-mode) nao mexem.
    awaiting: false,
    promptPreview: null,
    userPrompts: [], // F8: ultimos prompts REAIS do humano (localizador de sessao)
    firstUserSlash: null, // null = nenhum texto de user visto ainda
    // F10: ts (ms) do ULTIMO prompt REAL do humano. Referencia do .ended:
    // o marcador vale enquanto nao houve prompt novo depois dele (a prosa de
    // fechamento do agente bumpa o transcript mas NAO mexe aqui).
    lastUserMs: 0,
    lastSeen: 0,
    lock: Promise.resolve(),
  };
}

function resetEntry(entry) {
  const keep = { lastSeen: entry.lastSeen, lock: entry.lock };
  Object.assign(entry, newEntry(), keep);
}

async function updatedEntry(file, size) {
  let entry = fileCache.get(file);
  if (!entry) {
    entry = newEntry();
    fileCache.set(file, entry);
  }
  entry.lastSeen = Date.now();
  // Serializa leituras concorrentes do mesmo arquivo (SSE + rota).
  const run = entry.lock.then(() => ingestFile(file, entry, size));
  entry.lock = run.catch(() => {});
  await entry.lock;
  return entry;
}

async function ingestFile(file, entry, size) {
  if (size < entry.offset) resetEntry(entry); // truncado ou rotacionado
  if (!entry.initialized) {
    entry.initialized = true;
    if (size > BOOT_TAIL_BYTES) {
      entry.offset = size - BOOT_TAIL_BYTES;
      entry.approxStart = true;
    }
  } else if (size - entry.offset > MAX_CHUNK_BYTES) {
    // Gap gigante entre ciclos: re-ancora no tail para nao travar o loop.
    entry.offset = size - BOOT_TAIL_BYTES;
    entry.approxStart = true;
  }
  if (size <= entry.offset) return;
  const buf = await readRange(file, entry.offset, size);
  if (buf) consumeBuffer(entry, buf);
}

async function readRange(file, start, end) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const len = end - start;
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return bytesRead === len ? buf : buf.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function consumeBuffer(entry, buf) {
  const lastNl = buf.lastIndexOf(NL);
  if (lastNl < 0) return; // linha parcial em escrita: espera completar
  const text = buf.toString('utf8', 0, lastNl + 1);
  entry.offset += lastNl + 1;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    entry.lines += 1;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue; // fragmento de boot ou lixo: ignorar
    }
    applyLine(entry, obj);
  }
}

function applyLine(entry, o) {
  if (!o || typeof o !== 'object') return;
  if (o.type === 'assistant' && o.message) {
    if (o.message.model) entry.model = o.message.model;
    addUsage(entry, o.message.usage, o.timestamp);
    eachToolUse(o, (name, input, ts) => recordAction(entry, name, input, ts));
    const narr = lastAssistantText(o);
    if (narr) entry.narrative = narr;
    const tail = clipTail(rawAssistantText(o), QUESTION_TAIL_LEN);
    if (tail) entry.narrativeTail = tail;
    // stop_reason 'tool_use' = vai rodar tool (trabalhando); end_turn/
    // stop_sequence = terminou de falar e aguarda o usuario.
    const sr = o.message.stop_reason;
    entry.awaiting = sr === 'end_turn' || sr === 'stop_sequence';
  } else if (o.type === 'user') {
    entry.awaiting = false; // humano respondeu OU tool_result: segue ativo
    // Prompt REAL do humano: exclui tool_result (toolUseResult) e linhas
    // injetadas isMeta=true (imagens, expansoes de skill/comando como
    // '# Encerrar Sessao'). So sobra o que o usuario digitou de fato.
    if (o.isMeta !== true && !o.toolUseResult) {
      const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
      applyUserLine(entry, o.message, ts);
    }
  }
}

function recordAction(entry, name, input, ts) {
  entry.lastTool = name;
  entry.currentAction = buildAction(name, input, ts);
  entry.recentActions.push({
    ts,
    tool: name,
    target: entry.currentAction.target,
    vaultPath: entry.currentAction.vaultPath,
    mcpServer: entry.currentAction.mcpServer,
  });
  if (entry.recentActions.length > RECENT_ACTIONS_MAX) entry.recentActions.shift();
  applyTaskTool(entry, name, input);
}

// F9: estado da task list para o checklist de missao. TaskCreate so traz
// {subject,activeForm} (sem id); TaskUpdate traz {taskId:"1",status}. Os ids
// sao sequenciais por ordem de criacao, entao mapeamos id "N" -> tasks[N-1].
// Com boot-tail aproximado a lista pode ser parcial: best-effort por design
// (a narrativa e o briefing LLM sao o sinal forte; o checklist e bonus).
function applyTaskTool(entry, name, input) {
  const inp = input && typeof input === 'object' ? input : {};
  if (name === 'TodoWrite') {
    if (Array.isArray(inp.todos)) {
      entry.tasks = inp.todos
        .map((t) => ({
          title: clip(t && (t.content || t.activeForm || t.title), TARGET_LEN),
          status: normTaskStatus(t && t.status),
        }))
        .filter((t) => t.title)
        .slice(0, TASKS_MAX);
    }
    return;
  }
  if (name === 'TaskCreate') {
    const title = clip(inp.subject || inp.title || inp.description || inp.name, TARGET_LEN);
    if (!title) return;
    entry.tasks.push({ title, status: 'pending' });
    if (entry.tasks.length > TASKS_MAX) entry.tasks.shift();
    return;
  }
  if (name === 'TaskUpdate') {
    const idx = parseInt(inp.taskId, 10) - 1;
    const st = normTaskStatus(inp.status);
    if (Number.isInteger(idx) && idx >= 0 && idx < entry.tasks.length) {
      entry.tasks[idx] = { ...entry.tasks[idx], status: st };
    }
  }
}

function normTaskStatus(s) {
  return s === 'in_progress' || s === 'completed' ? s : 'pending';
}

// F9: ultimo bloco {type:'text'} de uma linha assistant = a prosa que o
// proprio agente escreve ('estou corrigindo os bugs X,Y,Z...'). Whitespace
// colapsado e clip; null se a linha so tem tool_use/thinking.
function rawAssistantText(o) {
  const content = o && o.message && o.message.content;
  if (!Array.isArray(content)) return null;
  let txt = null;
  for (const c of content) {
    if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) txt = c.text;
  }
  return txt;
}

function lastAssistantText(o) {
  const txt = rawAssistantText(o);
  if (!txt) return null;
  const clean = txt.replace(/\s+/g, ' ').trim();
  return clean.length > NARRATIVE_LEN ? clean.slice(0, NARRATIVE_LEN) : clean;
}

// v2: clip pelo FIM ("…ultimas N chars") — a pergunta de um turno awaiting
// costuma estar no final da prosa, nao no comeco. Strip de markdown leve
// (**bold**, `code`, headers) porque o texto vira UI crua. Puro e exportado.
export function clipTail(text, max) {
  const clean = String(text || '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  return clean.length > max ? '…' + clean.slice(clean.length - max + 1) : clean;
}

function addUsage(entry, usage, ts) {
  if (!usage || typeof usage !== 'object') return;
  const inTok = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
  const outTok = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
  const cacheRead = Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0;
  const cacheCreate = Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0;
  entry.tokensIn += inTok;
  entry.tokensOut += outTok;
  // Contexto corrente = tudo que entrou na ULTIMA chamada (cache conta).
  const ctx = inTok + cacheRead + cacheCreate;
  if (ctx > 0) entry.contextTokens = ctx;
  // O jsonl nao expoe a janela do modelo ([1m] nao aparece no campo model):
  // deteccao sticky — passou de 200k uma vez, a janela so pode ser 1M.
  if (ctx > 200_000) entry.ctxBig = true;
  noteUsage(inTok, outTok, cacheRead, cacheCreate, ts);
}

function applyUserLine(entry, message, tsMs) {
  const raw = rawUserText(message);
  if (raw === null) return;
  if (entry.firstUserSlash === null) entry.firstUserSlash = raw.startsWith('/');
  // Wrappers de comando/sistema (<command-name> etc) nao sao prompt do usuario.
  if (raw.startsWith('<')) return;
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (!clean) return;
  // F10: prompt REAL confirmado => marca o instante (referencia do .ended).
  if (Number.isFinite(tsMs) && tsMs > entry.lastUserMs) entry.lastUserMs = tsMs;
  if (!entry.promptPreview) entry.promptPreview = clean.slice(0, PREVIEW_LEN);
  // F8: historico dos ultimos prompts reais (localizador "em q parte estamos").
  entry.userPrompts.push(clean.slice(0, PROMPT_LOG_LEN));
  if (entry.userPrompts.length > PROMPT_LOG_MAX) entry.userPrompts.shift();
}

function rawUserText(message) {
  if (!message) return null;
  const c = message.content;
  if (typeof c === 'string') return c.trim() || null;
  if (Array.isArray(c)) {
    const part = c.find((p) => p && p.type === 'text' && typeof p.text === 'string');
    if (part) return part.text.trim() || null;
  }
  return null;
}

// Itera os blocos tool_use de uma linha assistant ja parseada, com o ts da
// propria linha. Usado pelo cache incremental E pelo tail dos subagents.
function eachToolUse(o, fn) {
  if (!o || o.type !== 'assistant' || !o.message) return;
  const content = o.message.content;
  if (!Array.isArray(content)) return;
  const ts = typeof o.timestamp === 'string' ? o.timestamp : null;
  for (const c of content) {
    if (c && c.type === 'tool_use' && c.name) fn(c.name, c.input, ts);
  }
}

// F-viz: extração pura do tail de UM subagente. Reúne currentAction (última
// tool), narrative (último texto) e o TRAIL das últimas `recentMax` ações
// (o "o que fez" do fluxo do Cockpit). Testável em node sem tocar disco.
export function collectSubActions(objs, recentMax) {
  let lastTool = null;
  let currentAction = null;
  let narrative = null;
  const recentActions = [];
  for (const o of objs) {
    eachToolUse(o, (name, input, ts) => {
      lastTool = name;
      currentAction = buildAction(name, input, ts);
      recentActions.push({ tool: currentAction.tool, target: currentAction.target, ts: currentAction.ts });
      if (recentActions.length > recentMax) recentActions.shift();
    });
    const n = lastAssistantText(o);
    if (n) narrative = n;
  }
  return { lastTool, currentAction, narrative, recentActions };
}

// ------------------------------------------------- extracao de acao (v3) ----
// Tabela do SPEC-F3: target curto para o balao da Sala, detail mais longo
// para tooltip. Tool desconhecida = target null (UI mostra so o tool).

// F7: a tabela de extracao virou funcao PURA, reusada pelo buildAction (que
// adiciona telemetria mcp/skill) e pelo describeAction() do /api/mirror.
function extractActionInfo(tool, inp) {
  return (
    fileAction(tool, inp) ||
    commandAction(tool, inp) ||
    patternAction(tool, inp) ||
    webAction(tool, inp) ||
    agentAction(tool, inp) ||
    skillAction(tool, inp) ||
    todoTaskAction(tool, inp) ||
    mcpAction(tool) || { target: null, detail: null }
  );
}

function buildAction(tool, input, ts) {
  const inp = input && typeof input === 'object' ? input : {};
  const info = extractActionInfo(tool, inp);
  const vaultPath = vaultRelPath(rawActionPath(tool, inp) ?? info.detail);
  const mcpServer = mcpServerOf(tool);
  if (mcpServer !== null) noteMcpUse(mcpServer, ts);
  if (tool === 'Skill') noteSkillUse(inp.skill, ts);
  return { tool, target: info.target, detail: info.detail, vaultPath, mcpServer, ts };
}

// F7 (C3.4): helper para o /api/mirror — mesma tabela, sem noteMcpUse nem
// noteSkillUse (o mirror re-le o tail a cada aba aberta; contar inflaria).
export function describeAction(tool, input) {
  if (typeof tool !== 'string' || !tool) return { tool: null, target: null, detail: null };
  const inp = input && typeof input === 'object' ? input : {};
  const info = extractActionInfo(tool, inp);
  return { tool, target: info.target, detail: info.detail };
}

// ------------------------------------------------- uso de MCPs (F5.8) ----
// mcpSeen acumula uso por server, atualizado DENTRO de buildAction (choke
// point unico: cobre o parse incremental da sessao E o tail dos subagents).
// Nota: o tail de subagents re-parseia as mesmas linhas a cada ciclo, entao
// count e indicador de atividade (aproximado), nao contador exato.

const mcpSeen = new Map();

// Segmento entre o 1o e o 2o '__' de 'mcp__<server>__<tool>'.
// Ex: 'mcp__claude_ai_Gmail__search_threads' => 'claude_ai_Gmail'.
// Sem 2o '__' (ou server vazio) => null.
function mcpServerOf(tool) {
  if (!tool.startsWith('mcp__')) return null;
  const rest = tool.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep > 0 ? rest.slice(0, sep) : null;
}

function noteMcpUse(server, ts) {
  const parsed = typeof ts === 'string' ? Date.parse(ts) : NaN;
  const usedTs = Number.isNaN(parsed) ? Date.now() : parsed;
  const prev = mcpSeen.get(server);
  mcpSeen.set(server, {
    // Re-parse de linhas antigas (tail de subagent) nao pode regredir o ts.
    lastUsedTs: prev && prev.lastUsedTs > usedTs ? prev.lastUsedTs : usedTs,
    count: prev ? prev.count + 1 : 1,
  });
  scheduleSeenSave();
}

// Leitura direta pelo modulo mcp.mjs (GET /api/mcp); o leitor nao muta.
export function getMcpSeen() {
  return mcpSeen;
}

// ------------------------------------------------- uso de Skills (F7) ----
// Mesmo padrao do mcpSeen: alimentado em buildAction quando tool==='Skill'.
// Key = input.skill cru (trim); a normalizacao p/ match e do consumidor.

const skillSeen = new Map();

function noteSkillUse(skill, ts) {
  const name = typeof skill === 'string' ? skill.trim() : '';
  if (!name) return;
  const parsed = typeof ts === 'string' ? Date.parse(ts) : NaN;
  const usedTs = Number.isNaN(parsed) ? Date.now() : parsed;
  const prev = skillSeen.get(name);
  skillSeen.set(name, {
    lastUsedTs: prev && prev.lastUsedTs > usedTs ? prev.lastUsedTs : usedTs,
    count: prev ? prev.count + 1 : 1,
  });
  scheduleSeenSave();
}

// Leitura direta pelo modulo skills.mjs (GET /api/skills); o leitor nao muta.
export function getSkillSeen() {
  return skillSeen;
}

// ------------------------------------------------- uso global de tokens ----
// Buckets de 10min alimentados por addUsage (so sessoes principais; os tails
// de subagents re-parseiam as mesmas linhas e inflariam). Dois mapas:
// usageLive acumula em runtime; usagePersisted vem do disco (boot). O valor
// real de um bucket e o MAX campo a campo entre os dois (o boot tail
// re-parseia linhas que o disco ja contou — somar dobraria).

const USAGE_BUCKET_MS = 10 * 60 * 1000;
const USAGE_KEEP_MS = 36 * 60 * 60 * 1000;
const usageLive = new Map(); // bucketStartMs -> {in,out,cacheRead,cacheCreate}
const usagePersisted = new Map();

function noteUsage(inTok, outTok, cacheRead, cacheCreate, ts) {
  if (inTok + outTok + cacheRead + cacheCreate <= 0) return;
  const parsed = typeof ts === 'string' ? Date.parse(ts) : NaN;
  const at = Number.isNaN(parsed) ? Date.now() : parsed;
  if (Date.now() - at > USAGE_KEEP_MS) return; // linha velha do boot tail
  const key = Math.floor(at / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
  const b = usageLive.get(key) || { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 };
  usageLive.set(key, {
    in: b.in + inTok,
    out: b.out + outTok,
    cacheRead: b.cacheRead + cacheRead,
    cacheCreate: b.cacheCreate + cacheCreate,
  });
  scheduleSeenSave();
}

function pruneUsage(map, now) {
  for (const key of map.keys()) {
    if (now - key > USAGE_KEEP_MS) map.delete(key);
  }
}

// MAX campo a campo entre live e persisted (nunca soma).
function mergedBucket(key) {
  const a = usageLive.get(key);
  const b = usagePersisted.get(key);
  if (!a) return b || null;
  if (!b) return a;
  return {
    in: Math.max(a.in, b.in),
    out: Math.max(a.out, b.out),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheCreate: Math.max(a.cacheCreate, b.cacheCreate),
  };
}

function sumRange(fromMs) {
  const acc = { in: 0, out: 0, cacheRead: 0, cacheCreate: 0 };
  const keys = new Set([...usageLive.keys(), ...usagePersisted.keys()]);
  for (const key of keys) {
    if (key < fromMs) continue;
    const b = mergedBucket(key);
    if (!b) continue;
    acc.in += b.in;
    acc.out += b.out;
    acc.cacheRead += b.cacheRead;
    acc.cacheCreate += b.cacheCreate;
  }
  return acc;
}

// Resumo p/ o /api/stats: ultima hora + hoje (meia-noite local).
export function getUsageSummary() {
  const now = Date.now();
  pruneUsage(usageLive, now);
  pruneUsage(usagePersisted, now);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return {
    hour: sumRange(now - 60 * 60 * 1000),
    today: sumRange(midnight.getTime()),
  };
}

// --------------------------------------- persistencia de seen (F7 C3.2) ----
// mcpSeen/skillSeen sobrevivem a restart em torre/.data/seen.json: load no
// boot (merge usa o MAIOR count/lastUsedTs entre disco e memoria — nunca
// soma, o tail re-parseado ja aproxima) e write debounced de 30s.

const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
const SEEN_SAVE_MS = 30 * 1000;
let seenSaveTimer = null;

function mergeSeenMap(map, plain) {
  if (!plain || typeof plain !== 'object') return;
  for (const [key, val] of Object.entries(plain)) {
    if (!key || !val || typeof val !== 'object') continue;
    const prev = map.get(key);
    const count = Math.max(
      Number.isFinite(val.count) ? val.count : 0,
      prev && Number.isFinite(prev.count) ? prev.count : 0
    );
    const ts = Math.max(
      Number.isFinite(val.lastUsedTs) ? val.lastUsedTs : 0,
      prev && Number.isFinite(prev.lastUsedTs) ? prev.lastUsedTs : 0
    );
    map.set(key, { count, lastUsedTs: ts > 0 ? ts : null });
  }
}

function loadUsageFromDisk(plain) {
  if (!plain || typeof plain !== 'object') return;
  for (const [key, val] of Object.entries(plain)) {
    const ms = Number(key);
    if (!Number.isFinite(ms) || !val || typeof val !== 'object') continue;
    usagePersisted.set(ms, {
      in: Number.isFinite(val.in) ? val.in : 0,
      out: Number.isFinite(val.out) ? val.out : 0,
      cacheRead: Number.isFinite(val.cacheRead) ? val.cacheRead : 0,
      cacheCreate: Number.isFinite(val.cacheCreate) ? val.cacheCreate : 0,
    });
  }
}

async function loadSeenFromDisk() {
  try {
    const raw = JSON.parse(await fsp.readFile(SEEN_FILE, 'utf8'));
    mergeSeenMap(mcpSeen, raw.mcp);
    mergeSeenMap(skillSeen, raw.skills);
    loadUsageFromDisk(raw.usage);
  } catch {
    // primeiro boot, arquivo ausente ou JSON corrompido: memoria vazia serve
  }
}

function scheduleSeenSave() {
  if (seenSaveTimer) return;
  seenSaveTimer = setTimeout(() => {
    seenSaveTimer = null;
    saveSeen().catch((err) => console.error('[sessions] seen.json:', err.message));
  }, SEEN_SAVE_MS);
  seenSaveTimer.unref();
}

async function saveSeen() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const usage = {};
  const keys = new Set([...usageLive.keys(), ...usagePersisted.keys()]);
  for (const key of keys) {
    const b = mergedBucket(key);
    if (b) usage[key] = b;
  }
  const payload = {
    mcp: Object.fromEntries(mcpSeen),
    skills: Object.fromEntries(skillSeen),
    usage,
  };
  await fsp.writeFile(SEEN_FILE, JSON.stringify(payload), 'utf8');
}

loadSeenFromDisk();

// Caminho BRUTO (sem clip) do arquivo da acao, quando a tool tem um. O clip de
// detail (160 chars) truncaria paths longos do vault e quebraria o match.
function rawActionPath(tool, inp) {
  if (!FILE_TOOLS.has(tool)) return null;
  const fp = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
  return typeof fp === 'string' ? fp : null;
}

// F4: se o path resolver dentro do vault, retorna o caminho relativo com
// separadores '/' e casing original (igual aos ids de node do /api/graph).
// Fora do vault, nao-path (comando, url, prompt) ou raiz exata -> null.
function vaultRelPath(p) {
  if (typeof p !== 'string') return null;
  const norm = p.trim().replace(/\\/g, '/');
  if (norm.toLowerCase().startsWith(VAULT_PREFIX_LC)) {
    return norm.slice(VAULT_PREFIX_LC.length) || null;
  }
  return null;
}

function fileAction(tool, inp) {
  if (!FILE_TOOLS.has(tool)) return null;
  const fp = typeof inp.file_path === 'string' ? inp.file_path : inp.notebook_path;
  if (typeof fp !== 'string' || !fp.trim()) return { target: null, detail: null };
  return { target: path.basename(fp.trim()), detail: clip(fp, DETAIL_LEN) };
}

function commandAction(tool, inp) {
  if (!CMD_TOOLS.has(tool)) return null;
  const cmd = typeof inp.command === 'string' ? firstLine(inp.command) : '';
  return { target: clip(cmd, CMD_TARGET_LEN), detail: clip(cmd, DETAIL_LEN) };
}

function patternAction(tool, inp) {
  if (!PATTERN_TOOLS.has(tool)) return null;
  const where = typeof inp.path === 'string' ? inp.path : inp.glob;
  return { target: clip(inp.pattern, TARGET_LEN), detail: clip(where, DETAIL_LEN) };
}

function webAction(tool, inp) {
  if (tool === 'WebSearch') {
    return { target: clip(inp.query, TARGET_LEN), detail: clip(inp.query, DETAIL_LEN) };
  }
  if (tool === 'WebFetch' || tool.endsWith('browser_navigate')) {
    if (typeof inp.url !== 'string') return { target: null, detail: null };
    return { target: urlHost(inp.url), detail: clip(inp.url, DETAIL_LEN) };
  }
  // Navegacao via browser MCP (claude-in-chrome navigate/tabs_create_mcp):
  // a URL vive no input; sem url cai no mcpAction generico (nome da tool).
  if (/__(navigate|tabs_create_mcp)$/.test(tool) && typeof inp.url === 'string') {
    return { target: urlHost(inp.url), detail: clip(inp.url, DETAIL_LEN) };
  }
  return null;
}

function agentAction(tool, inp) {
  // 'Task' exato = spawn de subagent legado (description/prompt), nao Task*.
  if (tool !== 'Agent' && tool !== 'Task') return null;
  const target = clip(inp.description, TARGET_LEN) || clip(inp.prompt, TARGET_LEN);
  return { target, detail: clip(inp.prompt || inp.description, DETAIL_LEN) };
}

// F7 (C3.1): Skill => target = nome da skill (antes do fallback generico).
// detail via skillArgsDetail: args do Skill pode ser string OU objeto (dict);
// clip() devolveria null para objeto e o detail sumia em toda skill run.
function skillAction(tool, inp) {
  if (tool !== 'Skill') return null;
  const name = typeof inp.skill === 'string' ? inp.skill.trim() : '';
  if (!name) return { target: null, detail: null };
  return { target: clip(name, TARGET_LEN), detail: skillArgsDetail(inp.args) };
}

// args string => clip direto; objeto => JSON.stringify clipado (catch cobre
// estrutura ciclica/nao-serializavel); qualquer outro tipo => null.
function skillArgsDetail(args) {
  if (typeof args === 'string') return clip(args, DETAIL_LEN);
  if (args && typeof args === 'object') {
    try {
      return clip(JSON.stringify(args), DETAIL_LEN);
    } catch {
      return null;
    }
  }
  return null;
}

function todoTaskAction(tool, inp) {
  if (tool === 'TodoWrite') {
    const first = Array.isArray(inp.todos) && inp.todos[0] ? inp.todos[0] : {};
    const title = first.content || first.activeForm || first.title;
    return { target: clip(title, TARGET_LEN), detail: null };
  }
  if (!tool.startsWith('Task')) return null;
  const title = inp.title || inp.subject || inp.description || inp.name;
  return { target: clip(title, TARGET_LEN), detail: null };
}

function mcpAction(tool) {
  if (!tool.startsWith('mcp__')) return null;
  return { target: tool.split('__').pop() || null, detail: null };
}

function clip(s, n) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

function firstLine(s) {
  const nl = s.indexOf('\n');
  return nl >= 0 ? s.slice(0, nl) : s;
}

function urlHost(u) {
  try {
    return new URL(u).host || clip(u, TARGET_LEN);
  } catch {
    return clip(u, TARGET_LEN);
  }
}

function pruneCache(now) {
  for (const [file, entry] of fileCache) {
    if (now - entry.lastSeen > CACHE_TTL_MS) fileCache.delete(file);
  }
}

// ------------------------------------------------------------ leitura tail ----
// Usada so pelos subagents (arquivos pequenos e descartaveis; sem cache).

async function readTailLines(file, maxLines) {
  let fh = null;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const len = Math.min(size, SUB_TAIL_BYTES);
    if (len === 0) return [];
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function parseJsonLines(lines) {
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // linha truncada ou lixo: ignorar
    }
  }
  return out;
}

// ------------------------------------------------------------ subagents ----

async function listSubagents(sessionDir, now) {
  const root = path.join(sessionDir, 'subagents');
  let names = [];
  try {
    names = await fsp.readdir(root, { recursive: true });
  } catch {
    return [];
  }
  const files = names.map(String).filter((n) => /agent-[^\\/]*\.jsonl$/i.test(n));
  const subs = [];
  for (const relName of files) {
    const sub = await buildSubagent(path.join(root, relName), now);
    if (sub) subs.push(sub);
  }
  subs.sort((a, b) => b.mtime - a.mtime);
  return subs.slice(0, SUB_CAP).map(({ mtime, ...rest }) => rest);
}

async function buildSubagent(file, now) {
  let st;
  try {
    st = await fsp.stat(file);
  } catch {
    return null;
  }
  if (now - st.mtimeMs > SUB_RECENT_MS) return null;
  const id = path.basename(file, '.jsonl');
  const meta = await subagentMeta(file, id);
  const objs = parseJsonLines(await readTailLines(file, SUB_TAIL_LINES));
  const { lastTool, currentAction, narrative, recentActions } = collectSubActions(objs, SUB_RECENT_ACTIONS);
  return {
    id,
    label: meta.label,
    agentType: meta.agentType, // F7 (C3.5): tipo do agente p/ Dossier/drones
    lastTool,
    currentAction,
    narrative, // F9: prosa do subagente (o que esta fazendo)
    recentActions, // F-viz: trail das últimas ações (fluxo do Cockpit)
    active: now - st.mtimeMs < ACTIVE_MS,
    mtime: st.mtimeMs,
  };
}

async function subagentMeta(file, fallback) {
  try {
    const raw = await fsp.readFile(file.replace(/\.jsonl$/i, '.meta.json'), 'utf8');
    const meta = JSON.parse(raw);
    const agentType =
      typeof meta.agentType === 'string' && meta.agentType.trim() ? meta.agentType.trim() : null;
    return { label: meta.description || meta.agentType || fallback, agentType };
  } catch {
    return { label: fallback, agentType: null };
  }
}

// --------------------------------------- arquivo por sessao (F7 C3.4) ----
// Map id -> caminho absoluto do jsonl, preenchido no scan normal de
// buildSession. Fallback p/ sessao ainda nao escaneada (ex: mirror aberto
// antes do primeiro getSessions): procura <id>.jsonl nos dirs de PROJECTS.
// id sanitizado [\w-]+ ANTES de virar path (guard de traversal).

const sessionFileById = new Map();
const SESSION_ID_RE = /^[\w-]+$/;

export async function getSessionFile(id) {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return null;
  const known = sessionFileById.get(id);
  if (known) return known;
  let projDirs = [];
  try {
    projDirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of projDirs) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(PROJECTS, d.name, `${id}.jsonl`);
    try {
      const st = await fsp.stat(candidate);
      if (st.isFile()) {
        sessionFileById.set(id, candidate);
        return candidate;
      }
    } catch {
      // nao esta neste projeto: segue procurando
    }
  }
  return null;
}

// ------------------------------------------------------------- sessoes ----

function projectLabel(dirName) {
  const stripped = dirName.replace(PROJECT_PREFIX_RE, '');
  return stripped || 'home';
}

function sessionState(ageMs) {
  if (ageMs < ACTIVE_MS) return 'ativa';
  if (ageMs < IDLE_MS) return 'ociosa';
  return 'dormindo';
}

function sessionKind(entry, state) {
  // One-shot headless: primeiro texto de user com '/' (claude -p "/comando"),
  // OU arquivo curto (<12 linhas) que nao esta ativo agora.
  if (entry.firstUserSlash === true) return 'tarefa';
  if (!entry.approxStart && entry.lines < TASK_LINE_MAX && state !== 'ativa') {
    return 'tarefa';
  }
  return 'interativa';
}

// Marcador .ended (irmao do transcript) = sessao ENCERRADA: a Torre mostra o
// agente dormindo NA HORA, sem esperar o mtime decair (~30min). Dois caminhos
// escrevem o marcador: (1) o hook SessionEnd no fim REAL do processo; (2) o
// passo final da skill /encerrar-sessao (mark-session-ended.mjs), que cobre o
// caso comum em que o usuario "encerra" sem fechar o terminal — ai o processo
// segue vivo e o SessionEnd nunca dispara.
//
// Referencia de validade = ts do ULTIMO prompt REAL do humano (lastUserMs),
// NAO o mtime do transcript. Motivo: depois do write do marcador o agente
// ainda escreve a prosa de fechamento ("sessao encerrada"), que bumpa o
// transcript mas NAO e prompt do humano — usar mtime invalidaria o marcador
// na hora. Marcador vale enquanto lastUserMs <= marker.mtime. Um prompt novo
// (lastUserMs > marker) = humano voltou a falar: self-heal apaga o stale.
// Sem lastUserMs conhecido (boot aproximado, 0) o marcador vence. Stat em
// try/catch: sem marcador OU erro de IO => false, segue o mtime normal.
async function endedMarkerActive(transcriptFile, lastUserMs) {
  const marker = transcriptFile.replace(/\.jsonl$/i, '.ended');
  try {
    const mst = await fsp.stat(marker);
    if (!(lastUserMs > mst.mtimeMs)) return true;
    fsp.unlink(marker).catch(() => {}); // humano resumiu: limpa o stale
    return false;
  } catch {
    return false;
  }
}

async function buildSession(dirAbs, dirName, fileName, st, now) {
  const file = path.join(dirAbs, fileName);
  const id = path.basename(fileName, '.jsonl');
  sessionFileById.set(id, file); // F7: alimenta o getSessionFile() do mirror
  const entry = await updatedEntry(file, st.size);
  let state = sessionState(now - st.mtimeMs);
  // Fim de sessao explicito (SessionEnd hook OU passo final do /encerrar-sessao)
  // => dorme na hora. Referencia = lastUserMs (nao o mtime do transcript).
  if (state !== 'dormindo' && (await endedMarkerActive(file, entry.lastUserMs))) {
    state = 'dormindo';
  }
  const subagents = await listSubagents(path.join(dirAbs, id), now);
  // topico: rotina p/ one-shot de slash-command; senao classifica sobre TODO
  // o texto conhecido da sessao (missao + prompts recentes + prosa) — sessao
  // gigante perde o head no boot-tail, entao quanto mais sinal melhor
  const topic = entry.firstUserSlash === true
    ? 'rotina'
    : inferTopic([entry.promptPreview, entry.userPrompts.join(' '), entry.narrative]
      .filter(Boolean).join(' '));
  return {
    id,
    project: projectLabel(dirName),
    topic, // v4: base do nome logico
    state,
    kind: sessionKind(entry, state),
    active: state === 'ativa', // compat com a UI atual ate o front F2 ligar
    lastActivityTs: new Date(st.mtimeMs).toISOString(),
    startedTs: new Date(st.birthtimeMs || st.mtimeMs).toISOString(),
    lastUserTs: entry.lastUserMs ?? null, // Task 4.3: ts (ms) do ultimo prompt real (rail TRABALHANDO)
    model: entry.model,
    lastTool: entry.lastTool,
    currentAction: entry.currentAction,
    awaitingInput: entry.awaiting === true, // F8: turno encerrado, aguarda
    secondsSinceEvent: Math.max(0, Math.round((now - st.mtimeMs) / 1000)),
    recentActions: entry.recentActions.slice(),
    promptPreview: entry.promptPreview,
    userPrompts: entry.userPrompts.slice(), // F8: localizador de sessao
    narrative: entry.narrative, // F9: prosa do agente (o que esta fazendo e por que)
    pendingQuestion: entry.awaiting === true ? entry.narrativeTail : null, // v2

    tasks: entry.tasks.slice(-TASKS_MAX), // F9: checklist de missao (best-effort)
    mission: entry.userPrompts.length
      ? entry.userPrompts[entry.userPrompts.length - 1]
      : entry.promptPreview, // F9: pedido MAIS RECENTE, nao o inicial congelado

    tokensIn: entry.tokensIn,
    tokensOut: entry.tokensOut,
    contextTokens: entry.contextTokens > 0 ? entry.contextTokens : null,
    contextLimit: entry.ctxBig ? 1_000_000 : 200_000,
    transcriptKb: Math.round(st.size / 1024),
    subagents,
  };
}

async function scanProject(dirAbs, dirName, now) {
  let entries = [];
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const file = path.join(dirAbs, e.name);
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > WINDOW_MS) continue;
    out.push(await buildSession(dirAbs, dirName, e.name, st, now));
  }
  return out;
}

export async function getSessions() {
  const now = Date.now();
  let projDirs = [];
  try {
    projDirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch (err) {
    console.error('[sessions] projects dir ilegivel:', err.message);
    return [];
  }
  const jobs = [];
  for (const d of projDirs) {
    if (!d.isDirectory()) continue;
    jobs.push(scanProject(path.join(PROJECTS, d.name), d.name, now));
  }
  const nested = await Promise.all(jobs);
  const sessions = nested.flat();
  sessions.sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      new Date(b.lastActivityTs) - new Date(a.lastActivityTs)
  );
  assignFleetNames(sessions); // v4: escreve .name = 'topico-N' em cada uma
  pruneCache(now);
  return sessions;
}

// Contagem barata (so stat, sem parse) para o /api/stats nao pagar o parse.
export async function countActiveSessions() {
  const now = Date.now();
  let projDirs = [];
  try {
    projDirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const d of projDirs) {
    if (!d.isDirectory()) continue;
    count += await countActiveIn(path.join(PROJECTS, d.name), now);
  }
  return count;
}

async function countActiveIn(dirAbs, now) {
  let entries = [];
  try {
    entries = await fsp.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    try {
      const st = await fsp.stat(path.join(dirAbs, e.name));
      if (now - st.mtimeMs < ACTIVE_MS) n++;
    } catch {
      // arquivo sumiu entre readdir e stat: ignorar
    }
  }
  return n;
}

// -------------------------------------------------------------- watcher ----

let watcher = null;

export function watchSessions(cb) {
  if (watcher) return watcher;
  let timer = null;
  watcher = chokidar.watch(PROJECTS, {
    ignoreInitial: true,
    depth: WATCH_DEPTH,
    ignored: (p) => {
      const ext = path.extname(String(p));
      return ext !== '' && ext !== '.jsonl';
    },
  });
  watcher.on('all', (event, file) => {
    if (!String(file).endsWith('.jsonl')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      cb();
    }, WATCH_DEBOUNCE_MS);
  });
  watcher.on('error', (err) => console.error('[sessions] watcher:', err.message));
  return watcher;
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/sessions', async (req, res) => {
    try {
      res.json(await getSessions());
    } catch (err) {
      console.error('[sessions]', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
}
