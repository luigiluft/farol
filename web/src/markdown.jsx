// FAROL - pipeline markdown Obsidian (agente M).
// Estrategia: um pre-processador de TEXTO converte [[wikilinks]] e ![[embeds]]
// para markdown padrao (protocolo wiki: + /api/asset) ANTES do parse, pulando
// blocos de codigo. Callouts > [!tipo] sao detectados no renderer de blockquote
// e viram <div class="callout tipo"> no DOM final, sem precisar de rehype-raw
// (nenhum HTML cru atravessa o parser; menos superficie de XSS).
// Resolucao de wikilink: cache em memoria seedado pelos links que /api/note ja
// devolve, com fallback assincrono em GET /api/resolve?name= para links fora
// da nota corrente. Nao-resolvido = classe "broken" (tracejado vermelho dim).
import { Children, isValidElement, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { fetchJson } from './api.js';

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']);

// 7 tipos do SPEC. glyph = caractere sobrio (nunca emoji colorido).
const CALLOUT_TYPES = {
  info: { glyph: 'i', label: 'Info' },
  warning: { glyph: '!', label: 'Atencao' },
  todo: { glyph: '☐', label: 'Tarefa' },
  success: { glyph: '✓', label: 'Sucesso' },
  danger: { glyph: '×', label: 'Perigo' },
  question: { glyph: '?', label: 'Pergunta' },
  faq: { glyph: '※', label: 'FAQ' },
};

// ---------------------------------------------------------------
// cache de resolucao de wikilinks (nome -> path relativo | null)
// ---------------------------------------------------------------
const resolveCache = new Map();

export function seedResolveCache(links) {
  if (!Array.isArray(links)) return;
  for (const link of links) {
    if (link && typeof link.name === 'string') {
      resolveCache.set(link.name, typeof link.path === 'string' ? link.path : null);
    }
  }
}

export async function resolveWikilink(name) {
  if (resolveCache.has(name)) return resolveCache.get(name);
  try {
    const data = await fetchJson('/api/resolve?name=' + encodeURIComponent(name));
    const resolved = data && typeof data.path === 'string' ? data.path : null;
    resolveCache.set(name, resolved);
    return resolved;
  } catch (err) {
    console.error('resolveWikilink falhou para "' + name + '":', err);
    return null; // nao cacheia falha: a rota pode estar pendente, tenta depois
  }
}

// ---------------------------------------------------------------
// pre-processador de texto (roda antes do react-markdown)
// ---------------------------------------------------------------
export function preprocessObsidian(markdown, notePath) {
  if (typeof markdown !== 'string' || markdown.length === 0) return '';
  return transformOutsideCode(stripFrontmatter(markdown), (chunk) =>
    transformChunk(chunk, notePath),
  );
}

// Defensivo: se o server mandar o frontmatter junto, remove o bloco --- ... ---
function stripFrontmatter(text) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  const after = text.indexOf('\n', end + 1);
  return after === -1 ? '' : text.slice(after + 1);
}

// Aplica fn apenas fora de blocos cercados (``` ou ~~~).
function transformOutsideCode(text, fn) {
  const parts = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : transformOutsideInline(part, fn)))
    .join('');
}

// Aplica fn apenas fora de codigo inline (`...`).
function transformOutsideInline(text, fn) {
  const parts = text.split(/(`[^`\n]*`)/);
  return parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

function transformChunk(text, notePath) {
  const withEmbeds = text.replace(/!\[\[([^[\]]+)\]\]/g, (full, inner) =>
    embedToMarkdown(inner, notePath),
  );
  return withEmbeds.replace(/\[\[([^[\]]+)\]\]/g, (full, inner) => wikilinkToMarkdown(inner));
}

function embedToMarkdown(inner, notePath) {
  const target = inner.split('|')[0].trim();
  const ext = (target.split('.').pop() || '').toLowerCase();
  if (IMG_EXTS.has(ext)) return '![' + target + '](' + assetUrl(target, notePath) + ')';
  if (ext === 'pdf') return '[' + target + '](' + assetUrl(target, notePath) + ')';
  return wikilinkToMarkdown(inner); // embed de nota vira link interno no MVP
}

function wikilinkToMarkdown(inner) {
  const [targetRaw, aliasRaw] = inner.split('|');
  const target = targetRaw.trim();
  const alias = (aliasRaw || target).trim();
  return '[' + escapeLinkText(alias) + '](wiki:' + encodeForMdDest(target) + ')';
}

// Embed com nome solto resolve relativo a pasta da nota (convencao de anexo
// mais comum); com '/' usa o caminho relativo ao vault como veio.
function assetUrl(target, notePath) {
  const rel = target.includes('/') ? target : joinNoteDir(notePath, target);
  return '/api/asset?path=' + encodeForMdDest(rel);
}

function joinNoteDir(notePath, name) {
  if (typeof notePath !== 'string' || !notePath.includes('/')) return name;
  return notePath.slice(0, notePath.lastIndexOf('/') + 1) + name;
}

// encodeURIComponent nao escapa parenteses, que quebram o destino de link md.
function encodeForMdDest(text) {
  return encodeURIComponent(text).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function escapeLinkText(text) {
  return text.replace(/([[\]])/g, '\\$1');
}

function decodeTarget(raw) {
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
}

// ---------------------------------------------------------------
// wikilink renderizado (resolve async, broken = tracejado vermelho)
// ---------------------------------------------------------------
function WikiLink({ target, children, onNavigate }) {
  const name = decodeTarget(target).split(/[#^]/)[0].trim();
  const [path, setPath] = useState(() =>
    resolveCache.has(name) ? resolveCache.get(name) : undefined,
  );

  useEffect(() => {
    let alive = true;
    if (resolveCache.has(name)) {
      setPath(resolveCache.get(name));
      return undefined;
    }
    resolveWikilink(name).then((resolved) => {
      if (alive) setPath(resolved);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  if (!name) return <span className="wikilink">{children}</span>;
  if (path === null) {
    return (
      <span className="wikilink broken" title={'nao encontrada no vault: ' + name}>
        {children}
      </span>
    );
  }
  return (
    <a
      href={'#/' + (path || '')}
      className={'wikilink' + (path === undefined ? ' pending' : '')}
      title={path || name}
      onClick={(e) => {
        e.preventDefault();
        if (path && onNavigate) onNavigate(path);
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------
// callouts (detectados no renderer de blockquote)
// ---------------------------------------------------------------
function extractCallout(children) {
  const items = Children.toArray(children);
  const pIndex = items.findIndex((c) => isValidElement(c) && c.type === 'p');
  if (pIndex === -1) return null;
  const onlyWhitespaceBefore = items
    .slice(0, pIndex)
    .every((c) => typeof c === 'string' && !c.trim());
  if (!onlyWhitespaceBefore) return null;
  const pKids = Children.toArray(items[pIndex].props.children);
  if (typeof pKids[0] !== 'string') return null;
  const match = pKids[0].match(/^\[!([a-zA-Z]+)\][+-]?[ \t]?/);
  if (!match) return null;
  const afterMarker = pKids[0].slice(match[0].length);
  const newline = afterMarker.indexOf('\n');
  const title = (newline === -1 ? afterMarker : afterMarker.slice(0, newline)).trim();
  const lead = [];
  if (newline !== -1 && afterMarker.slice(newline + 1)) lead.push(afterMarker.slice(newline + 1));
  lead.push(...pKids.slice(1));
  return { type: match[1].toLowerCase(), title, lead, rest: items.slice(pIndex + 1) };
}

function Callout({ type, title, lead, rest }) {
  const known = Object.prototype.hasOwnProperty.call(CALLOUT_TYPES, type);
  const cfg = known ? CALLOUT_TYPES[type] : CALLOUT_TYPES.info;
  const cls = known ? type : 'info';
  const hasBody = lead.length > 0 || rest.length > 0;
  return (
    <div className={'callout ' + cls}>
      <div className="callout-head">
        <span className="callout-icon" aria-hidden="true">
          {cfg.glyph}
        </span>
        <span className="callout-title">{title || cfg.label}</span>
      </div>
      {hasBody && (
        <div className="callout-body">
          {lead.length > 0 && <p>{lead}</p>}
          {rest}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// componentes custom do react-markdown
// ---------------------------------------------------------------
function buildComponents(onNavigate, notePath) {
  return {
    a: ({ node, href, children, ...rest }) => {
      if (typeof href === 'string' && href.startsWith('wiki:')) {
        return (
          <WikiLink target={href.slice(5)} onNavigate={onNavigate}>
            {children}
          </WikiLink>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" {...rest}>
          {children}
        </a>
      );
    },
    blockquote: ({ node, children, ...rest }) => {
      const callout = extractCallout(children);
      if (!callout) return <blockquote {...rest}>{children}</blockquote>;
      return <Callout {...callout} />;
    },
    img: ({ node, src, alt, ...rest }) => (
      <img src={normalizeAssetSrc(src, notePath)} alt={alt || ''} loading="lazy" {...rest} />
    ),
  };
}

// Imagem md padrao com caminho relativo tambem passa pelo /api/asset.
function normalizeAssetSrc(src, notePath) {
  if (typeof src !== 'string' || src.length === 0) return src;
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  return '/api/asset?path=' + encodeURIComponent(joinNoteDir(notePath, decodeTarget(src)));
}

// ---------------------------------------------------------------
// componente principal
// ---------------------------------------------------------------
export default function ObsidianMarkdown({ markdown, notePath, links, onNavigate }) {
  seedResolveCache(links);
  const processed = useMemo(() => preprocessObsidian(markdown, notePath), [markdown, notePath]);
  const components = useMemo(() => buildComponents(onNavigate, notePath), [onNavigate, notePath]);
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
