// Parser do formato obsidian-kanban (colunas '## X', cards '- [ ] texto').
// Puro: sem React/DOM — checável em node direto.
export function isKanbanNote(frontmatter) {
  return Boolean(frontmatter && frontmatter['kanban-plugin']);
}

export function parseKanban(markdown) {
  const cols = [];
  let cur = null;
  for (const ln of String(markdown || '').split(/\r?\n/)) {
    const h = ln.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = { title: h[1], cards: [] }; cols.push(cur); continue; }
    const c = ln.match(/^-\s+\[( |x|X)\]\s+(.*)$/);
    if (c && cur) cur.cards.push({ done: c[1] !== ' ', text: c[2].trim() });
  }
  return cols;
}

export function splitWikilinks(text) {
  const out = [];
  let rest = String(text || '');
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
  for (;;) {
    const m = rest.match(re);
    if (!m) { if (rest) out.push({ text: rest }); return out; }
    if (m.index > 0) out.push({ text: rest.slice(0, m.index) });
    out.push({ link: m[1].trim(), alias: (m[2] || m[1]).trim() });
    rest = rest.slice(m.index + m[0].length);
  }
}
