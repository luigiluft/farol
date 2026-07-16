// FAROL - identidade amigavel das sessoes (F7 C2). W-SHELL cria;
// Fleet/Terminal/Room/Feed consomem. callsign(id) da NOME DE ESTRELA
// por sessao SEM colisao (hash deterministico como slot preferido +
// registry module-level; vira o nome primario em chips, cartao, hangar,
// FlightBoard, Dossier e abas do Terminal; flightCode(id) segue
// existindo como codigo curto secundario). droneCallsign(id) nomeia
// subagentes. actionPhrase(s) traduz a acao corrente para PT-BR amigavel
// com fallback generico 'rodando <tool>'; null SO quando nao ha tool
// nenhuma (payload v2 nunca quebra).
import { actionLabel } from './roomData.js';
import { getFleetName } from './fleet-names.js';

const CALLSIGN_POOL = [
  'Vega', 'Sirius', 'Lyra', 'Orion', 'Antares', 'Rigel', 'Capella', 'Mira',
  'Polaris', 'Deneb', 'Altair', 'Castor', 'Pollux', 'Spica', 'Aldebaran',
  'Bellatrix', 'Canopus', 'Procyon', 'Atria', 'Alya', 'Nashira', 'Sargas',
  'Alnair', 'Mimosa', 'Acrux', 'Gacrux', 'Avior', 'Izar', 'Kochab', 'Sadr',
  'Tarazed', 'Alcor', 'Mizar', 'Meissa', 'Naos', 'Pavo', 'Phact', 'Wezen',
  'Adhara', 'Maia',
];

const DRONE_POOL = [
  'Faisca', 'Centelha', 'Pixel', 'Byte', 'Eco', 'Pulso', 'Ion', 'Foton',
  'Quark', 'Lumen', 'Atomo', 'Vetor', 'Chispa', 'Orbe', 'Mote', 'Brisa',
];

// Labels amigaveis dos servicos MCP (mesmo catalogo do server C3.2).
const MCP_LABELS = {
  claude_ai_Gmail: 'Gmail',
  claude_ai_Google_Calendar: 'Agenda Google',
  claude_ai_Google_Drive: 'Drive',
  claude_ai_Granola: 'Granola',
  claude_ai_Notion: 'Notion',
  claude_ai_Supabase: 'Supabase',
  claude_ai_Context7: 'Context7',
  claude_ai_Figma: 'Figma',
  claude_ai_Canva: 'Canva',
  claude_ai_Gamma: 'Gamma',
  playwright: 'Navegador',
  'windows-mcp': 'Windows',
  apify: 'Apify',
  higgsfield: 'Higgsfield',
  lovable: 'Lovable',
};

const TARGET_MAX_CHARS = 40;

// Hash djb2 (mesma familia do projectColor): nome estavel por id.
function hashId(id) {
  const s = String(id || '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Registry vivo de callsigns: o hash continua sendo o slot PREFERIDO
// (mesma sessao tende a ganhar o mesmo nome entre reloads), mas a
// alocacao final passa por um registro module-level id -> nome. Se o
// nome preferido ja pertence a OUTRO id vivo, probe linear ate o
// proximo slot livre do pool; pool esgotado => repete a volta com
// sufixo romano (' II', ' III', ...). Sem eviction: a atribuicao e
// estavel enquanto a pagina viver ('Vega' nunca troca de sessao).
const callsignById = new Map();
const idByCallsign = new Map();

// Numeral romano minimo para o sufixo de geracao (2, 3, 4...).
const ROMAN_PAIRS = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n) {
  let out = '';
  let rest = n;
  for (const [val, sym] of ROMAN_PAIRS) {
    while (rest >= val) {
      out += sym;
      rest -= val;
    }
  }
  return out;
}

// Probe linear a partir do slot preferido; cada "geracao" e uma volta
// completa no pool com o sufixo seguinte (g0 sem sufixo, g1 ' II'...).
const MAX_GENERATIONS = 8; // 8 voltas = 320 nomes; alem disso e irreal

function allocateCallsign(id) {
  const len = CALLSIGN_POOL.length;
  const start = hashId(id) % len;
  for (let gen = 0; gen < MAX_GENERATIONS; gen += 1) {
    const suffix = gen === 0 ? '' : ' ' + toRoman(gen + 1);
    for (let i = 0; i < len; i += 1) {
      const name = CALLSIGN_POOL[(start + i) % len] + suffix;
      if (!idByCallsign.has(name)) return name;
    }
  }
  // Ultimo recurso (320+ sessoes na mesma pagina): ainda unico por id.
  return CALLSIGN_POOL[start] + ' ' + toRoman(callsignById.size + 1);
}

// sessionId -> nome da sessao. v4: prioridade pro NOME LOGICO do server
// ('topico-N', registrado pelo api.js a cada snapshot); estrela do pool vira
// fallback (sessao historica fora da janela, payload antigo, drones).
export function callsign(id) {
  const key = String(id || '');
  const logical = getFleetName(key);
  if (logical) return logical;
  const got = callsignById.get(key);
  if (got) return got;
  const name = allocateCallsign(key);
  callsignById.set(key, name);
  idByCallsign.set(name, key);
  return name;
}

// subagentId -> nome curto de drone, deterministico (pool de 16).
export function droneCallsign(id) {
  return DRONE_POOL[hashId(id) % DRONE_POOL.length];
}

// Label amigavel de um servidor MCP; fallback: strip claude_ai_, _ -> espaco.
export function mcpLabel(serverId) {
  const id = String(serverId || '').trim();
  if (!id) return 'MCP';
  if (MCP_LABELS[id]) return MCP_LABELS[id];
  return id.replace(/^claude_ai_/, '').replace(/_/g, ' ');
}

function clipText(text, max = TARGET_MAX_CHARS) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Caminho -> nome de arquivo; texto solto passa direto (clipado).
function shortTarget(target) {
  const s = String(target || '').trim();
  if (!s) return '';
  const last = s.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s;
  return clipText(last);
}

// URL -> host; se nao parsear, devolve o texto clipado.
function hostOf(target) {
  const s = String(target || '').trim();
  if (!s) return '';
  try {
    return new URL(s).hostname;
  } catch (err) {
    return clipText(s);
  }
}

function joinPhrase(verb, complement) {
  return complement ? verb + ' ' + complement : verb;
}

// tool 'mcp__<srv>__<tool>' -> id do servidor ('mcp__claude_ai_Gmail__x'
// -> 'claude_ai_Gmail'). Servidores nao usam '__' no proprio id.
function mcpServerOf(tool) {
  const parts = String(tool).split('__');
  return parts.length >= 2 ? parts[1] : '';
}

// Traducao tool -> frase PT-BR. Sempre devolve frase quando ha tool:
// nao mapeada cai no generico 'rodando <tool>' (nunca vaza nome cru solto).
function phraseFor(tool, target) {
  // Navegacao via browser MCP mostra ONDE (host), nao so o servidor.
  if (/__(navigate|tabs_create_mcp)$|browser_navigate$/.test(tool) && target) {
    return joinPhrase('navegando', hostOf(target));
  }
  if (tool.startsWith('mcp__')) return 'consultando ' + mcpLabel(mcpServerOf(tool));
  switch (tool) {
    case 'Read': return joinPhrase('lendo', shortTarget(target));
    case 'Edit':
    case 'MultiEdit': return joinPhrase('editando', shortTarget(target));
    case 'Write': return joinPhrase('escrevendo', shortTarget(target));
    case 'Grep':
    case 'Glob': return joinPhrase('procurando', clipText(target));
    case 'Bash':
    case 'PowerShell': return joinPhrase('executando', clipText(target));
    case 'WebSearch': return joinPhrase('pesquisando', clipText(target));
    case 'WebFetch':
    case 'browser_navigate': return joinPhrase('navegando', hostOf(target));
    case 'Agent':
    case 'Task': return target ? 'delegando: ' + clipText(target) : 'delegando';
    case 'TodoWrite': return 'planejando';
    case 'Skill': return joinPhrase('usando skill', clipText(target));
    case 'AskUserQuestion': return 'perguntando';
    case 'Workflow': return 'orquestrando';
    case 'TaskOutput': return 'coletando resultado';
    case 'TaskCreate': return 'planejando tarefa';
    case 'TaskUpdate': return 'atualizando tarefa';
    case 'TaskList': return 'listando tarefas';
    case 'Monitor': return 'monitorando';
    case 'StructuredOutput': return 'estruturando resposta';
    case 'ToolSearch': return 'buscando ferramenta';
    case 'ScheduleWakeup': return 'agendando retorno';
    case 'SendMessage':
    case 'SendUserMessage': return 'enviando mensagem';
    default: return 'rodando ' + clipText(tool);
  }
}

// Sessao OU subagent -> frase amigavel da acao corrente.
// Defensivo: payload v2 (sem currentAction) cai no lastTool; sem tool
// NENHUMA => null (consumidores tem guards proprios de null).
export function actionPhrase(s) {
  if (!s || typeof s !== 'object') return null;
  const a = s.currentAction;
  const tool = a && a.tool ? String(a.tool) : (s.lastTool ? String(s.lastTool) : null);
  if (!tool) return null;
  const target = a && a.tool ? (a.target != null ? String(a.target) : '') : '';
  const phrase = phraseFor(tool, target);
  return phrase || actionLabel(s);
}
