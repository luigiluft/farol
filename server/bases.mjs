// FAROL - modulo bases (Path 1 / Fase B).
// Le arquivos .base do Obsidian (YAML) e resolve VIEWS (table/cards) sobre o
// snapshot do indice do vault: filtros (and/or/not + condicoes-string), colunas
// (order), sort, groupBy e formulas. Avaliador de expressao PROPRIO e fail-closed
// (erro de condicao = permissivo + warning; erro de celula = vazio + warning) —
// nunca derruba o server. .base sao arquivos do usuario (confiaveis); ainda assim
// ha cap de tamanho e o parse roda em try/catch.

import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { notesSnapshot, safePath, VAULT_ROOT } from './vault.mjs';

const EXCLUDED = new Set(['.obsidian', '.claude', '.git', '.trash']);
const MAX_BASE_BYTES = 256 * 1024;
const DAY_MS = 86400000;

// ----------------------------------------------------------- parse .base ----

function parseBase(raw) {
  // Reusa o engine YAML do gray-matter envelopando como frontmatter.
  const wrapped = `---\n${String(raw).replace(/\r\n/g, '\n').replace(/\n?---\s*$/g, '\n')}\n---\n`;
  const { data } = matter(wrapped);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('conteudo .base nao e um objeto YAML');
  }
  return data;
}

// ------------------------------------------------------------- avaliador ----
// Tokenizer + recursive-descent. Valores: string|number|boolean|null|Date|Duration.
// Duration = { __dur:true, days, hours, minutes, ms } (diferenca de Dates).

const FILE = Symbol('file');

function tokenize(src) {
  const toks = [];
  const re = /\s+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|>=|<=|==|!=|&&|\|\||[(),.!<>+\-*/]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?/g;
  let m;
  let last = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index !== last) throw new Error(`token invalido perto de "${src.slice(last, m.index + 1)}"`);
    last = re.lastIndex;
    const t = m[0];
    if (/^\s+$/.test(t)) continue;
    toks.push(t);
  }
  if (last !== src.length) throw new Error(`token invalido perto de "${src.slice(last)}"`);
  return toks;
}

function parseExpr(toks) {
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t) => { if (toks[i] !== t) throw new Error(`esperava "${t}"`); i++; };

  function primary() {
    const t = peek();
    if (t === undefined) throw new Error('expressao incompleta');
    if (t === '(') { next(); const e = orExpr(); expect(')'); return e; }
    if (t === '!') { next(); return { k: 'not', a: unary() }; }
    if (t === '-') { next(); return { k: 'neg', a: unary() }; }
    if (t[0] === '"' || t[0] === "'") { next(); return { k: 'lit', v: unquote(t) }; }
    if (/^\d/.test(t)) { next(); return { k: 'lit', v: Number(t) }; }
    if (/^[A-Za-z_]/.test(t)) { next(); return { k: 'id', name: t }; }
    throw new Error(`token inesperado "${t}"`);
  }
  function postfix() {
    let node = primary();
    while (peek() === '.') {
      next();
      const name = next();
      if (!/^[A-Za-z_]/.test(name || '')) throw new Error('membro invalido');
      if (peek() === '(') { node = { k: 'call', obj: node, name, args: argList() }; }
      else node = { k: 'member', obj: node, name };
    }
    // chamada direta de funcao: ident '(' ... ')'  (ex: now(), if(...), date(...))
    if (node.k === 'id' && peek() === '(') node = { k: 'call', obj: null, name: node.name, args: argList() };
    return node;
  }
  function argList() {
    expect('(');
    const args = [];
    if (peek() !== ')') { args.push(orExpr()); while (peek() === ',') { next(); args.push(orExpr()); } }
    expect(')');
    return args;
  }
  function unary() { return postfix(); }
  function mul() { let l = unary(); while (peek() === '*' || peek() === '/') { const op = next(); l = { k: 'bin', op, l, r: unary() }; } return l; }
  function add() { let l = mul(); while (peek() === '+' || peek() === '-') { const op = next(); l = { k: 'bin', op, l, r: mul() }; } return l; }
  function cmp() { let l = add(); while (['==', '!=', '<', '>', '<=', '>='].includes(peek())) { const op = next(); l = { k: 'bin', op, l, r: add() }; } return l; }
  function andExpr() { let l = cmp(); while (peek() === '&&') { next(); l = { k: 'and', l, r: cmp() }; } return l; }
  function orExpr() { let l = andExpr(); while (peek() === '||') { next(); l = { k: 'or', l, r: andExpr() }; } return l; }

  const ast = orExpr();
  if (i !== toks.length) throw new Error(`sobra de tokens em "${toks.slice(i).join(' ')}"`);
  return ast;
}

function unquote(t) {
  return t.slice(1, -1).replace(/\\(.)/g, '$1');
}

const exprCache = new Map();
function compile(src) {
  if (exprCache.has(src)) return exprCache.get(src);
  const ast = parseExpr(tokenize(src));
  exprCache.set(src, ast);
  return ast;
}

// --------------------------------------------------------------- runtime ----

function truthy(v) {
  if (v == null || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function makeCtx(note, now, formulas) {
  const props = note.data || {};
  const memo = new Map();
  const evaluating = new Set();
  const ctx = {
    note, now, props,
    formula(name) {
      if (memo.has(name)) return memo.get(name);
      const src = formulas[name];
      if (src == null) return null;
      if (evaluating.has(name)) throw new Error(`formula circular: ${name}`);
      evaluating.add(name);
      let val = null;
      try { val = evalNode(compile(String(src)), ctx); } finally { evaluating.delete(name); }
      memo.set(name, val);
      return val;
    },
  };
  return ctx;
}

function fileMember(note, name) {
  switch (name) {
    case 'name': return note.title || path.basename(note.rel).replace(/\.md$/i, '');
    case 'path': return note.rel;
    case 'ext': return 'md';
    case 'folder': return note.rel.includes('/') ? note.rel.slice(0, note.rel.lastIndexOf('/')) : '';
    case 'mtime': case 'ctime': return new Date(note.mtimeMs || 0);
    case 'tags': return note.tags || [];
    default: return null;
  }
}

function fileMethod(note, name, args) {
  const a0 = args[0] != null ? String(args[0]).replace(/^#/, '').toLowerCase() : '';
  switch (name) {
    case 'hasTag': return (note.tags || []).some((t) => t === a0 || t.startsWith(a0 + '/'));
    case 'inFolder': return note.rel === a0 || note.rel.toLowerCase().startsWith(a0.toLowerCase().replace(/\/+$/, '') + '/');
    case 'hasProperty': return Object.prototype.hasOwnProperty.call(note.data || {}, args[0]) && (note.data[args[0]] !== null && note.data[args[0]] !== undefined);
    case 'hasLink': return false;
    default: throw new Error(`metodo file.${name} nao suportado`);
  }
}

function duration(ms) {
  return { __dur: true, ms, seconds: ms / 1000, minutes: ms / 60000, hours: ms / 3600000, days: ms / DAY_MS, weeks: ms / (DAY_MS * 7), months: ms / (DAY_MS * 30), years: ms / (DAY_MS * 365) };
}

function evalNode(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'id': {
      const name = n.name;
      if (name === 'file') return FILE;
      if (name === 'null') return null;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'now' || name === 'today') return ctx.now; // forma sem () tolerada
      if (name === 'formula') return { __ns: 'formula' };
      // identificador simples = propriedade do frontmatter
      const v = ctx.props[name];
      return v === undefined ? null : v;
    }
    case 'member': {
      if (n.obj.k === 'id' && n.obj.name === 'file') return fileMember(ctx.note, n.name);
      if (n.obj.k === 'id' && n.obj.name === 'formula') return ctx.formula(n.name);
      const o = evalNode(n.obj, ctx);
      if (o && o.__dur) return o[n.name] ?? null;
      if (o instanceof Date) return dateMember(o, n.name);
      if (o && typeof o === 'object') return o[n.name] ?? null;
      return null;
    }
    case 'call': {
      if (n.obj && n.obj.k === 'id' && n.obj.name === 'file') {
        return fileMethod(ctx.note, n.name, n.args.map((a) => evalNode(a, ctx)));
      }
      if (n.obj == null) {
        if (n.name === 'now' || n.name === 'today') return ctx.now;
        if (n.name === 'if') return truthy(evalNode(n.args[0], ctx)) ? evalNode(n.args[1], ctx) : evalNode(n.args[2], ctx);
        if (n.name === 'date') return new Date(evalNode(n.args[0], ctx));
        if (n.name === 'number') return Number(evalNode(n.args[0], ctx));
        if (n.name === 'lower') return String(evalNode(n.args[0], ctx) ?? '').toLowerCase();
        throw new Error(`funcao ${n.name}() nao suportada`);
      }
      throw new Error('chamada invalida');
    }
    case 'not': return !truthy(evalNode(n.a, ctx));
    case 'neg': return -Number(evalNode(n.a, ctx));
    case 'and': return truthy(evalNode(n.l, ctx)) && truthy(evalNode(n.r, ctx));
    case 'or': return truthy(evalNode(n.l, ctx)) ? true : truthy(evalNode(n.r, ctx));
    case 'bin': return evalBin(n.op, evalNode(n.l, ctx), evalNode(n.r, ctx));
    default: throw new Error(`no desconhecido ${n.k}`);
  }
}

function dateMember(d, name) {
  switch (name) {
    case 'year': return d.getFullYear();
    case 'month': return d.getMonth() + 1;
    case 'day': return d.getDate();
    default: return null;
  }
}

function asTime(v) { return v instanceof Date ? v.getTime() : null; }

function evalBin(op, l, r) {
  if (op === '-') {
    const lt = asTime(l); const rt = asTime(r);
    if (lt != null && rt != null) return duration(lt - rt);
    return Number(l) - Number(r);
  }
  if (op === '+') return (typeof l === 'string' || typeof r === 'string') ? String(l ?? '') + String(r ?? '') : Number(l) + Number(r);
  if (op === '*') return Number(l) * Number(r);
  if (op === '/') return Number(l) / Number(r);
  if (op === '==' || op === '!=') {
    const eq = looseEq(l, r);
    return op === '==' ? eq : !eq;
  }
  // <,>,<=,>= : datas/numeros/strings
  const lv = cmpVal(l); const rv = cmpVal(r);
  if (op === '<') return lv < rv;
  if (op === '>') return lv > rv;
  if (op === '<=') return lv <= rv;
  if (op === '>=') return lv >= rv;
  throw new Error(`op ${op} nao suportado`);
}

function looseEq(l, r) {
  if (l == null || r == null) return (l == null) && (r == null);
  if (l instanceof Date || r instanceof Date) return cmpVal(l) === cmpVal(r);
  if (typeof l === 'number' || typeof r === 'number') return Number(l) === Number(r);
  if (typeof l === 'boolean' || typeof r === 'boolean') return Boolean(l) === Boolean(r);
  return String(l) === String(r);
}

function cmpVal(v) {
  if (v instanceof Date) return v.getTime();
  if (v && v.__dur) return v.ms;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? String(v ?? '') : (String(v).trim() === '' ? String(v) : n);
}

// --------------------------------------------------------------- filtros ----

function evalCondition(src, ctx, warnings) {
  try {
    return truthy(evalNode(compile(src), ctx));
  } catch (err) {
    warnings.push(`condicao ignorada ("${src}"): ${err.message}`);
    return true; // fail-open: nao esconde linhas por causa de condicao nao suportada
  }
}

function passFilter(node, ctx, warnings) {
  if (node == null) return true;
  if (typeof node === 'string') return evalCondition(node, ctx, warnings);
  if (Array.isArray(node)) return node.every((c) => passFilter(c, ctx, warnings)); // lista nua = AND
  if (typeof node === 'object') {
    if ('and' in node) return toArr(node.and).every((c) => passFilter(c, ctx, warnings));
    if ('or' in node) return toArr(node.or).some((c) => passFilter(c, ctx, warnings));
    if ('not' in node) return !toArr(node.not).some((c) => passFilter(c, ctx, warnings));
  }
  return true;
}

function toArr(x) { return Array.isArray(x) ? x : x == null ? [] : [x]; }

// ------------------------------------------------------------- resolucao ----

function colLabel(ref, properties) {
  const p = properties && properties[ref];
  if (p && p.displayName) return p.displayName;
  if (ref === 'file.name') return 'Nome';
  if (ref === 'file.mtime') return 'Modificado';
  if (ref === 'file.ctime') return 'Criado';
  if (ref.startsWith('formula.')) return ref.slice('formula.'.length);
  return ref;
}

function fmtCell(v) {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (v && v.__dur) return String(Math.round(v.days * 10) / 10);
  if (typeof v === 'boolean') return v ? 'sim' : 'nao';
  if (Array.isArray(v)) return v.map((x) => fmtCell(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function refExpr(ref) {
  // 'file.name'/'formula.heat'/'status' -> AST. Property nua tambem compila como id.
  return compile(ref);
}

function resolveView(view, baseFilters, formulas, properties, notes, now, warnings) {
  const order = Array.isArray(view.order) && view.order.length ? view.order : ['file.name'];
  const groupRef = view.groupBy && view.groupBy.property ? view.groupBy.property : null;
  const cols = [...order];
  if (groupRef && !cols.includes(groupRef)) cols.push(groupRef);

  const rows = [];
  for (const note of notes) {
    const ctx = makeCtx(note, now, formulas);
    if (!passFilter(baseFilters, ctx, warnings)) continue;
    if (view.filters && !passFilter(view.filters, ctx, warnings)) continue;
    const cells = {};
    const raw = {};
    for (const ref of cols) {
      let v = null;
      try { v = evalNode(refExpr(ref), ctx); }
      catch (err) { warnings.push(`coluna "${ref}" falhou: ${err.message}`); }
      raw[ref] = v;
      cells[ref] = fmtCell(v);
    }
    rows.push({ path: note.rel, title: note.title, cells, _raw: raw });
  }

  applySort(rows, view.sort);
  for (const r of rows) delete r._raw;

  return {
    name: view.name || 'View',
    type: view.type || 'table',
    columns: cols.map((ref) => ({ id: ref, label: colLabel(ref, properties) })),
    groupBy: groupRef,
    rows,
  };
}

function applySort(rows, sort) {
  if (!Array.isArray(sort) || !sort.length) return;
  rows.sort((a, b) => {
    for (const s of sort) {
      const ref = s.property;
      const dir = String(s.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
      const av = cmpVal(a._raw ? a._raw[ref] : a.cells[ref]);
      const bv = cmpVal(b._raw ? b._raw[ref] : b.cells[ref]);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

// ------------------------------------------------------------ listar/ler ----

async function listBaseFiles(dirAbs, relDir, out) {
  let entries;
  try { entries = await fsp.readdir(dirAbs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || EXCLUDED.has(e.name)) continue;
    const rel = relDir ? relDir + '/' + e.name : e.name;
    if (e.isDirectory()) await listBaseFiles(path.join(dirAbs, e.name), rel, out);
    else if (e.name.toLowerCase().endsWith('.base')) out.push(rel);
  }
  return out;
}

async function handleListBases(req, res) {
  const rels = await listBaseFiles(VAULT_ROOT, '', []);
  rels.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  res.json(rels.map((rel) => ({ path: rel, name: path.basename(rel).replace(/\.base$/i, '') })));
}

async function handleBase(req, res) {
  const target = safePath(req.query.path, '.base');
  if (!target) return res.status(400).json({ error: 'path invalido' });
  let st;
  try { st = await fsp.stat(target.abs); } catch { return res.status(404).json({ error: 'base nao encontrada' }); }
  if (st.size > MAX_BASE_BYTES) return res.status(413).json({ error: 'base grande demais' });

  let config;
  try {
    const raw = await fsp.readFile(target.abs, 'utf8');
    config = parseBase(raw);
  } catch (err) {
    return res.status(422).json({ error: `falha ao parsear .base: ${err.message}`, views: [] });
  }

  const warnings = [];
  const formulas = (config.formulas && typeof config.formulas === 'object') ? config.formulas : {};
  const properties = (config.properties && typeof config.properties === 'object') ? config.properties : {};
  const baseFilters = config.filters || null;
  const viewDefs = Array.isArray(config.views) && config.views.length
    ? config.views
    : [{ type: 'table', name: 'Tabela', order: ['file.name'] }];

  const notes = await notesSnapshot();
  const now = new Date();
  const views = viewDefs.map((v) => {
    try {
      return resolveView(v, baseFilters, formulas, properties, notes, now, warnings);
    } catch (err) {
      warnings.push(`view "${v && v.name}" falhou: ${err.message}`);
      return { name: (v && v.name) || 'View', type: (v && v.type) || 'table', columns: [], groupBy: null, rows: [] };
    }
  });

  res.json({ path: target.rel, name: path.basename(target.rel).replace(/\.base$/i, ''), views, warnings });
}

// -------------------------------------------------------------- registro ----

function safeRoute(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      console.error('[bases]', req.path, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  };
}

export function register(app) {
  app.get('/api/bases', safeRoute(handleListBases));
  app.get('/api/base', safeRoute(handleBase));
}
