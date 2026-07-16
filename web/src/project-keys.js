// FAROL - project-keys.js (refactor v2, F3). Identidade canonica de
// projeto pro join Projetos v2 <-> diary/sessions/pendencias.
// PIN r2 do cross-review: a CLASSIFICACAO vem SEMPRE do server (topic do
// sessions/diary via topics.mjs) — este modulo so NORMALIZA strings pra
// slug + tabela de alias; nenhuma regra nova no client.

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// alias: variacoes de nome que apontam pro MESMO projeto (pasta do vault
// com nome longo vs topic curto do server). Chave e valor ja slugificados.
const ALIASES = {
  // vazio por padrão: mapeie aqui variações de nome que apontam pro mesmo
  // projeto (ex.: 'minha-loja-hub': 'minha-loja'). Sem alias, o slug do
  // próprio nome vira a chave.
};

export function projectKey(nameOrTopic) {
  const slug = slugify(nameOrTopic);
  return ALIASES[slug] || slug;
}

// pendencia.projeto e texto livre ("Loja Aurora — pipeline de fotos"):
// match por INCLUSAO do key no slug do texto (nunca o contrario, senao
// "loja" casaria com "lojista" — corte no limite de palavra do slug).
export function pendenciaMatches(projetoText, key) {
  if (!projetoText || !key) return false;
  const t = slugify(projetoText);
  return t === key || t.startsWith(`${key}-`) || t.includes(`-${key}-`) || t.endsWith(`-${key}`);
}
