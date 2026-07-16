// FAROL - sintese de prosa do Diario (Frente 1). Recebe os FATOS mecanicos
// de uma sessao ENCERRADA e devolve {resumo, pendencia} na voz C (resultado
// primeiro). Reusa o caminho OpenRouter do briefing.mjs (gemini-2.5-flash,
// chave em torre/.env); cai para Anthropic Haiku se so houver ANTHROPIC_API_KEY.
// Sem chave => {resumo:null} e a UI cai no fallback mecanico. O cache vive no
// diary.mjs (entry inteiro por id+mtime); aqui e so a chamada LLM + parse.

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_BRIEFING_MODEL || 'claude-haiku-4-5';
const MAX_OUT_TOKENS = 220;
const MAX_FILES = 12;

let clientPromise = null;

const SYSTEM_PROMPT =
  'Voce e "FAROL". Resuma o que foi FEITO numa sessao de trabalho JA ' +
  'ENCERRADA, para o operador relembrar de relance. Resultado/estado primeiro, ' +
  'depois o como. PT-BR, no maximo 2 frases, no maximo 32 palavras no total, ' +
  'numero antes de adjetivo, zero filler. NAO comece com "o agente" nem "nesta ' +
  'sessao". Responda SOMENTE um objeto JSON valido, sem markdown e sem cercas ' +
  'de codigo, exatamente: {"resumo":"...","pendencia":"..."}. Em "pendencia" ' +
  'coloque o que ficou por fazer; se nada ficou pendente, use o valor literal "" ' +
  '(uma string vazia, NAO escreva as palavras "string vazia" nem "nenhuma").';

function trimmed(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Provider escolhido por chave disponivel; OpenRouter tem prioridade.
function provider() {
  if (trimmed(process.env.OPENROUTER_API_KEY)) return 'openrouter';
  if (trimmed(process.env.ANTHROPIC_API_KEY)) return 'anthropic';
  return null;
}

export function proseEnabled() {
  return provider() !== null;
}

// SDK Anthropic lazy + memoizado; falha de import nao derruba o modulo.
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

async function callOpenRouter(system, user) {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'torre-diary',
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

function asStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Defesa: LLM as vezes escreve as PALAVRAS "string vazia"/"nenhuma" em vez de
// devolver "". Normaliza esses casos para vazio (senao a UI mostra ⚑ falso).
const EMPTY_PENDENCIA_RE = /^(string vazia|vazia|nenhuma|nenhum|nada|sem pendencia[s]?|n\/?a|none|null|-)\.?$/i;
function normalizePendencia(v) {
  const s = asStr(v);
  return EMPTY_PENDENCIA_RE.test(s) ? '' : s;
}

// Extrai o primeiro objeto {...} do texto e valida; fallback usa o texto cru
// como resumo. Nunca lanca.
function parseProse(text) {
  const raw = typeof text === 'string' ? text : '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      return { resumo: asStr(o.resumo), pendencia: normalizePendencia(o.pendencia) };
    } catch {
      // cai no fallback
    }
  }
  return { resumo: raw.replace(/\s+/g, ' ').trim().slice(0, 200), pendencia: '' };
}

function buildUserContent(facts) {
  const parts = [];
  if (facts.pedido) parts.push('PEDIDO INICIAL:\n' + facts.pedido);
  if (facts.mission && facts.mission !== facts.pedido) {
    parts.push('PEDIDO MAIS RECENTE:\n' + facts.mission);
  }
  const files = Array.isArray(facts.files) ? facts.files.slice(0, MAX_FILES) : [];
  if (files.length) {
    parts.push('ARQUIVOS TOCADOS (' + (facts.fileCount ?? files.length) + '):\n' + files.join(', '));
  }
  if (facts.commits > 0) parts.push('COMMITS: ' + facts.commits);
  if (facts.narrative) parts.push('ULTIMA FALA DO AGENTE:\n' + facts.narrative);
  if (!parts.length) return 'Sessao sem atividade legivel.';
  return parts.join('\n\n');
}

// facts = {pedido, mission, files, fileCount, commits, narrative}. Retorna
// {resumo, pendencia, model}. Lanca em falha de rede/HTTP (diary.mjs captura).
export async function summarizeSession(facts) {
  const prov = provider();
  if (!prov) return { resumo: null, pendencia: null, model: null };
  const user = buildUserContent(facts);
  const { text, model } = prov === 'openrouter'
    ? await callOpenRouter(SYSTEM_PROMPT, user)
    : await callAnthropic(SYSTEM_PROMPT, user);
  const parsed = parseProse(text);
  return { resumo: parsed.resumo || null, pendencia: parsed.pendencia || null, model };
}
