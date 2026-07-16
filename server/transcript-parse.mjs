// FAROL - helpers PUROS de parse de transcript .jsonl, compartilhados.
// Criados na Frente 1 (Diario) para NAO inflar a sessions.mjs (ja em 1007
// linhas, acima do teto de 800 da casa). A sessions.mjs mantem suas copias
// inline; aqui vivem so as funcoes que o diary.mjs precisa. Refactor da
// sessions.mjs para consumir este modulo = limpeza futura, fora de escopo.

// Texto REAL do humano numa linha 'user'. content pode ser string OU array de
// blocos; pega o primeiro bloco {type:'text'}. null se nao houver texto.
export function rawUserText(message) {
  if (!message) return null;
  const c = message.content;
  if (typeof c === 'string') return c.trim() || null;
  if (Array.isArray(c)) {
    const part = c.find((p) => p && p.type === 'text' && typeof p.text === 'string');
    if (part) return part.text.trim() || null;
  }
  return null;
}

// Uma linha 'user' e prompt REAL do humano quando nao e meta (imagem/expansao
// de skill) nem tool_result, e o texto nao comeca com '<' (wrapper de comando).
export function isRealUserPrompt(o) {
  if (!o || o.type !== 'user' || o.isMeta === true || o.toolUseResult) return false;
  const raw = rawUserText(o.message);
  return typeof raw === 'string' && raw.length > 0 && !raw.startsWith('<');
}

// Parse defensivo linha-a-linha de um texto jsonl: devolve os objetos validos,
// ignorando linhas vazias/truncadas/lixo (mesmo padrao da sessions.mjs).
export function parseLines(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // fragmento de boot/tail ou lixo: ignora
    }
  }
  return out;
}

// Colapsa whitespace e corta em n chars; null para nao-string/vazio.
export function clip(s, n) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

// Primeira linha de um comando multi-linha.
export function firstLine(s) {
  if (typeof s !== 'string') return '';
  const nl = s.indexOf('\n');
  return nl >= 0 ? s.slice(0, nl) : s;
}
