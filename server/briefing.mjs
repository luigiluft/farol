// FAROL - modulo briefing (F9). Sintetiza, sob demanda, um briefing de
// missao em PT-BR a partir do transcript de uma sessao: "o que o agente esta
// fazendo, em que etapa, o que falta". Resolve o pedido do dono de ver o
// CONTEXTO semantico em vez da acao crua de ferramenta.
//
// Tier mais simples (1 chamada LLM, sumarizacao). PROVIDER auto-detectado:
//   1) OPENROUTER_API_KEY -> OpenRouter (default google/gemini-2.5-flash;
//      ~$0.0005 por briefing, cache 90s = centavos/mes). Caminho PREFERIDO:
//      reusa a chave que o dono ja tem (cross-review), so HTTP, sem spinar
//      processo e sem criar transcript-fantasma que a Torre leria como agente.
//   2) ANTHROPIC_API_KEY -> Anthropic Haiku 4.5 (SDK lazy).
//   3) nenhuma -> {enabled:false} e a UI cai na narrativa crua + checklist de
//      tasks, que ja vem do /api/sessions sem custo.
// As chaves vivem em torre/.env (dotenv, carregado no index.mjs); gitignored.

import fsp from 'node:fs/promises';
import { getSessionFile } from './sessions.mjs';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_BRIEFING_MODEL || 'claude-haiku-4-5';
const TAIL_BYTES = 96 * 1024; // janela do tail lida do transcript
const CACHE_TTL_MS = 90 * 1000; // re-sintetiza no maximo a cada 90s por sessao
const MAX_TEXTS = 8; // ultimos blocos de prosa do agente enviados ao modelo
const MAX_ACTIONS = 15; // ultimas acoes de ferramenta enviadas
const TEXT_CLIP = 400;
const MAX_OUT_TOKENS = 400;
const SESSION_ID_RE = /^[\w-]+$/;

const cache = new Map(); // id -> { mtimeMs, at, data }
let clientPromise = null;

const SYSTEM_PROMPT =
  'Voce e o painel de operacoes "FAROL". Resuma, em PT-BR, o que um agente ' +
  'de IA esta fazendo numa sessao de trabalho, para o operador ver de relance. ' +
  'Seja concreto, curto e direto (numero antes de adjetivo, zero filler). ' +
  'Responda SOMENTE com um objeto JSON valido, sem markdown e sem cercas de ' +
  'codigo, exatamente neste formato: ' +
  '{"resumo":"1-2 frases do que o agente esta fazendo e por que","etapa":"a ' +
  'etapa atual em poucas palavras","falta":"o que ainda falta em poucas ' +
  'palavras (string vazia se nada claro)"}.';

function trimmed(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Provider escolhido por chave disponivel; OpenRouter tem prioridade.
function provider() {
  if (trimmed(process.env.OPENROUTER_API_KEY)) return 'openrouter';
  if (trimmed(process.env.ANTHROPIC_API_KEY)) return 'anthropic';
  return null;
}

function hasKey() {
  return provider() !== null;
}

// SDK Anthropic lazy + cliente memoizado. Falha de import (nao instalado) nao
// derruba o modulo: o handler captura e devolve enabled:false.
function getClient() {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then((m) => new m.default({ apiKey: process.env.ANTHROPIC_API_KEY }))
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

// Chamada OpenRouter (OpenAI-compatible chat/completions). Mesmo padrao do
// cross-review.mjs. Retorna {text, model}.
async function callOpenRouter(system, user) {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'torre-briefing',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: MAX_OUT_TOKENS,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content) || '';
  return { text, model: OPENROUTER_MODEL };
}

// Chamada Anthropic Haiku via SDK. Retorna {text, model}.
async function callAnthropic(system, user) {
  const client = await getClient();
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUT_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = (msg.content || [])
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return { text, model: ANTHROPIC_MODEL };
}

function userText(message) {
  if (!message) return null;
  const c = message.content;
  if (typeof c === 'string') return c.trim() || null;
  if (Array.isArray(c)) {
    const p = c.find((x) => x && x.type === 'text' && typeof x.text === 'string');
    if (p) return p.text.trim() || null;
  }
  return null;
}

function actionLabel(c) {
  const inp = c.input && typeof c.input === 'object' ? c.input : {};
  const arg = inp.file_path || inp.command || inp.description || inp.query || inp.pattern || inp.skill;
  const tail = typeof arg === 'string' && arg.trim() ? ' ' + arg.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return c.name + tail;
}

// Le o tail do transcript e destila o contexto enviado ao modelo: missao
// (ultimo prompt humano real), prosa recente do agente e acoes recentes.
async function extractContext(file) {
  const st = await fsp.stat(file);
  const len = Math.min(st.size, TAIL_BYTES);
  let buf;
  const fh = await fsp.open(file, 'r');
  try {
    buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
  } finally {
    await fh.close().catch(() => {});
  }
  const lines = buf.toString('utf8').split('\n');
  let mission = null;
  const texts = [];
  const actions = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      continue; // linha truncada (tail comeca no meio) ou lixo
    }
    if (o.type === 'user' && o.isMeta !== true && !o.toolUseResult) {
      const u = userText(o.message);
      if (u && !u.startsWith('<')) mission = u.replace(/\s+/g, ' ').trim().slice(0, 300);
    } else if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c && c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          texts.push(c.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CLIP));
        } else if (c && c.type === 'tool_use' && c.name) {
          actions.push(actionLabel(c));
        }
      }
    }
  }
  return {
    mission,
    texts: texts.slice(-MAX_TEXTS),
    actions: actions.slice(-MAX_ACTIONS),
    mtimeMs: st.mtimeMs,
  };
}

function buildUserContent(ctx) {
  const parts = [];
  if (ctx.mission) parts.push('PEDIDO DO OPERADOR (missao mais recente):\n' + ctx.mission);
  if (ctx.texts.length) {
    parts.push(
      'O QUE O AGENTE ESCREVEU (cronologico, mais recente por ultimo):\n' +
        ctx.texts.map((t) => '- ' + t).join('\n')
    );
  }
  if (ctx.actions.length) {
    parts.push('ACOES RECENTES (ferramentas):\n' + ctx.actions.map((a) => '- ' + a).join('\n'));
  }
  if (!parts.length) return 'Sessao sem atividade legivel ainda.';
  return parts.join('\n\n');
}

function asStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Parse defensivo: extrai o primeiro objeto {...} do texto e valida os campos.
// Fallback: usa o texto cru como resumo. Nunca lanca.
function parseBriefing(text) {
  const raw = typeof text === 'string' ? text : '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      return { resumo: asStr(o.resumo), etapa: asStr(o.etapa), falta: asStr(o.falta) };
    } catch {
      // cai no fallback abaixo
    }
  }
  return { resumo: raw.replace(/\s+/g, ' ').trim().slice(0, 300), etapa: '', falta: '' };
}

async function synthesize(ctx) {
  const user = buildUserContent(ctx);
  const prov = provider();
  const { text, model } = prov === 'openrouter'
    ? await callOpenRouter(SYSTEM_PROMPT, user)
    : await callAnthropic(SYSTEM_PROMPT, user);
  return { ...parseBriefing(text), model };
}

async function briefingFor(id) {
  const file = await getSessionFile(id);
  if (!file) return { enabled: hasKey(), error: 'sessao nao encontrada' };
  const ctx = await extractContext(file);
  if (!hasKey()) {
    return {
      enabled: false,
      reason: 'sem ANTHROPIC_API_KEY no ambiente do server',
      mission: ctx.mission,
    };
  }
  const cached = cache.get(id);
  if (cached && cached.mtimeMs === ctx.mtimeMs && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  const parsed = await synthesize(ctx); // {resumo, etapa, falta, model}
  const data = { enabled: true, mission: ctx.mission, ...parsed };
  cache.set(id, { mtimeMs: ctx.mtimeMs, at: Date.now(), data });
  return data;
}

export function register(app) {
  app.get('/api/briefing', async (req, res) => {
    const id = String(req.query.id || '');
    if (!SESSION_ID_RE.test(id)) {
      res.status(400).json({ enabled: false, error: 'id invalido' });
      return;
    }
    try {
      res.json(await briefingFor(id));
    } catch (err) {
      // Qualquer falha (SDK ausente, erro de API, refusal) degrada: a UI
      // cai na narrativa crua. Nunca 500.
      res.json({ enabled: false, error: err && err.message ? err.message : 'falha no briefing' });
    }
  });
}
