// FAROL - Cockpit v2: pane do TERMINAL (espelho read-only por TURNOS).
// useMirror/mapMirrorLine migraram do Cockpit.jsx SEM mudanca de contrato
// (poll 3s por cursor, janela anterior via before=, stick no fim). O render
// agrupa por prompt do usuario (groupTurns). Dois modos (torre.ckTermMode):
// RESUMO (default) = cada turno colapsa em 1 linha de RESULTADO (turnDigest) +
// chip de acoes + "abrir turno" (expande aquele turno); COMPLETO = a prosa
// inteira (markdown via ProseMd) + rajadas de acao. O raw (texto cru, pra
// quando o markdown estraga) e um controle discreto que so aparece no completo.
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { fetchJson } from './api.js';
import { actionPhrase } from './callsigns.js';
import {
  groupTurns, actsSummary, fmtClock, turnDigest,
} from './cockpit-model.js';
import ProseMd from './ProseMd.jsx';

const MIRROR_POLL_MS = 3000;
const MAX_MIRROR_LINES = 4000; // buffer vivo do tail
const HARD_MAX_LINES = 12000; // teto ao navegar historico (load-more)
const BEFORE_BYTES = 200 * 1024; // janela de bytes do "carregar mais"
const STICK_EPSILON_PX = 28;
const MIRROR_KINDS = new Set(['user', 'text', 'tool', 'result']);
const MD_KEY = 'torre.ckMd';
const TERM_MODE_KEY = 'torre.ckTermMode';

function readMdPref() {
  try {
    return localStorage.getItem(MD_KEY) !== 'raw';
  } catch {
    return true;
  }
}

function writeMdPref(md) {
  try {
    localStorage.setItem(MD_KEY, md ? 'md' : 'raw');
  } catch {
    // storage indisponivel (privado/quota): preferencia so dura a sessao
  }
}

// Modo de leitura do espelho: 'resumo' (digest, default) | 'completo'.
function readTermMode() {
  try {
    return localStorage.getItem(TERM_MODE_KEY) === 'completo' ? 'completo' : 'resumo';
  } catch {
    return 'resumo';
  }
}

function writeTermMode(mode) {
  try {
    localStorage.setItem(TERM_MODE_KEY, mode === 'completo' ? 'completo' : 'resumo');
  } catch {
    // storage indisponivel: preferencia so dura a sessao
  }
}

// ---------------------------------------------------------------- dados ----

// Traduz uma linha crua do /api/mirror (sem seq). tool => frase PT-BR.
export function mapMirrorLine(ln) {
  if (!ln || typeof ln !== 'object' || !MIRROR_KINDS.has(ln.kind)) return null;
  let text;
  if (ln.kind === 'tool') {
    const action = {
      tool: typeof ln.tool === 'string' ? ln.tool : null,
      target: typeof ln.target === 'string' ? ln.target : null,
    };
    text = actionPhrase({ ...action, currentAction: action })
      || (action.tool ? 'rodando ' + action.tool : '');
  } else {
    text = typeof ln.text === 'string' ? ln.text : '';
  }
  if (!text) return null;
  return { kind: ln.kind, time: fmtClock(ln.ts), text };
}

// Wrapper com seq crescente (forward). O prepend do "carregar mais" mapeia
// via mapMirrorLine e atribui seq DECRESCENTE para nao colidir com o forward.
function normLine(ln, seqRef) {
  const m = mapMirrorLine(ln);
  if (!m) return null;
  seqRef.current += 1;
  return { seq: seqRef.current, ...m };
}

// Poll por cursor do espelho READ-ONLY + janela ANTERIOR sob demanda.
// Contrato identico ao do Cockpit v1 (migrado intacto).
export function useMirror(id, followRef) {
  const [lines, setLines] = useState([]);
  const [atStart, setAtStart] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prependTick, setPrependTick] = useState(0);
  const cursorRef = useRef(null); // forward: proximo byte a ler
  const headRef = useRef(null); // topo do buffer (1o byte carregado)
  const fwdSeqRef = useRef(0);
  const topSeqRef = useRef(0);
  const lenRef = useRef(0);
  const busyRef = useRef(false);
  const moreBusyRef = useRef(false);

  useEffect(() => { lenRef.current = lines.length; }, [lines]);

  useEffect(() => {
    setLines([]);
    setAtStart(false);
    setLoadingMore(false);
    cursorRef.current = null;
    headRef.current = null;
    fwdSeqRef.current = 0;
    topSeqRef.current = 0;
    if (!id) return undefined;
    let alive = true;

    const apply = (data) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      if (headRef.current === null && Number.isFinite(data.head)) {
        headRef.current = data.head;
        if (data.atStart || data.head === 0) setAtStart(true);
      }
      if (Number.isFinite(data.cursor)) cursorRef.current = data.cursor;
      const raw = Array.isArray(data.lines) ? data.lines : [];
      const fresh = [];
      for (const ln of raw) {
        const norm = normLine(ln, fwdSeqRef);
        if (norm) fresh.push(norm);
      }
      if (!fresh.length) return;
      setLines((prev) => {
        const next = prev.concat(fresh);
        const following = !followRef || followRef.current !== false;
        const cap = following ? MAX_MIRROR_LINES : HARD_MAX_LINES;
        return next.length > cap ? next.slice(next.length - cap) : next;
      });
    };

    const poll = async () => {
      if (!alive || busyRef.current) return;
      busyRef.current = true;
      try {
        const q = cursorRef.current === null ? '' : '&cursor=' + cursorRef.current;
        const data = await fetchJson('/api/mirror?session=' + encodeURIComponent(id) + q);
        if (alive) apply(data);
      } catch {
        // sessao/rota indisponivel agora: o proximo tick tenta de novo
      } finally {
        busyRef.current = false;
      }
    };

    poll();
    const timer = setInterval(() => { if (!document.hidden) poll(); }, MIRROR_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [id, followRef]);

  const loadMore = useCallback(async () => {
    if (moreBusyRef.current) return;
    if (lenRef.current >= HARD_MAX_LINES) { setAtStart(true); return; }
    const head = headRef.current;
    if (head === null || head <= 0) { setAtStart(true); return; }
    moreBusyRef.current = true;
    setLoadingMore(true);
    try {
      const data = await fetchJson(
        '/api/mirror?session=' + encodeURIComponent(id) + '&before=' + head + '&bytes=' + BEFORE_BYTES,
      );
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const raw = Array.isArray(data.lines) ? data.lines : [];
      const batch = [];
      for (const ln of raw) {
        const m = mapMirrorLine(ln);
        if (m) batch.push(m);
      }
      if (Number.isFinite(data.head)) headRef.current = data.head;
      if (data.atStart || (Number.isFinite(data.head) && data.head <= 0) || batch.length === 0) {
        setAtStart(true);
      }
      if (batch.length) {
        const base = topSeqRef.current - batch.length;
        for (let i = 0; i < batch.length; i += 1) batch[i].seq = base + i;
        topSeqRef.current = base;
        setLines((prev) => batch.concat(prev));
        setPrependTick((t) => t + 1);
      }
    } catch {
      // janela indisponivel agora: o botao segue e o usuario re-tenta
    } finally {
      moreBusyRef.current = false;
      setLoadingMore(false);
    }
  }, [id]);

  return { lines, loadMore, atStart, loadingMore, prependTick };
}

// --------------------------------------------------------------- render ----

function ActsRow({ group }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ck-acts" onClick={() => setOpen((v) => !v)}>
        <span className="ck-mk">{'⚙'}</span>
        <span className="ck-acts-sum">{actsSummary(group.list)}</span>
        <span className="ck-acts-x">{open ? 'recolher ▴' : 'expandir ▾'}</span>
      </button>
      {open && (
        <div className="ck-acts-detail">
          {group.list.map((l) => (
            <div key={l.seq} className={'ck-ln ' + l.kind}>
              <span className="ck-ts">{l.time}</span>
              <span className="ck-mk">{l.kind === 'tool' ? '⚙' : '↳'}</span>
              <span className="ck-bd">{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Turn({ block, md, onCollapse }) {
  const body = block.items.map((it, i) => {
    if (it.kind === 'acts') return <ActsRow key={'a' + i} group={it} />;
    return md
      ? <ProseMd key={'p' + i} text={it.line.text} />
      : <div key={'p' + i} className="ck-prose">{it.line.text}</div>;
  });
  if (!block.user && body.length === 0) return null;
  return (
    <div className="ck-turn">
      {block.user && (
        <div className="ck-turn-h">
          <span className="ck-mk">{'❯'}</span>
          <span className="ck-turn-tx">{block.user.text}</span>
          <span className="ck-ts">{block.user.time}</span>
          {onCollapse && (
            <button type="button" className="ck-dg-collapse" onClick={onCollapse}>recolher ▴</button>
          )}
        </div>
      )}
      {body.length > 0 && <div className="ck-turn-b">{body}</div>}
    </div>
  );
}

// Rumo A: turno colapsado numa linha de RESULTADO (ultima prosa) + chip das
// acoes somadas + "abrir turno" (expande aquele turno em completo).
function TurnDigest({ block, onOpen }) {
  const dg = turnDigest(block);
  if (!block.user && !dg.result && !dg.actsSum) return null;
  return (
    <div className="ck-turn ck-turn-dg">
      {block.user && (
        <div className="ck-turn-h">
          <span className="ck-mk">{'❯'}</span>
          <span className="ck-turn-tx">{block.user.text}</span>
          <span className="ck-ts">{block.user.time}</span>
        </div>
      )}
      {dg.result && (
        <div className="ck-dg-res">
          <span className="ck-dg-chk">{'✓'}</span>
          <span className="ck-dg-txt">{dg.result}</span>
        </div>
      )}
      {(dg.actsSum || dg.hasBody) && (
        <div className="ck-dg-row">
          {dg.actsSum && <span className="ck-dg-chip">{dg.actsSum}</span>}
          {dg.hasBody && (
            <button type="button" className="ck-dg-open" onClick={onOpen}>abrir turno ▸</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TerminalPane({ id }) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const { lines, loadMore, atStart, loadingMore, prependTick } = useMirror(id, stickRef);
  const [hasNew, setHasNew] = useState(false);
  const [mode, setMode] = useState(readTermMode);
  const [openTurns, setOpenTurns] = useState(() => new Set());
  const [md, setMd] = useState(readMdPref);
  const lastPrependRef = useRef(0);
  const didPrependRef = useRef(false);
  const preserveRef = useRef(null);

  // Prepend (carregar mais): preserva a posicao ancorando pelo delta de altura.
  useLayoutEffect(() => {
    if (prependTick === lastPrependRef.current) return;
    lastPrependRef.current = prependTick;
    didPrependRef.current = true;
    const el = scrollRef.current;
    const p = preserveRef.current;
    if (el && p) el.scrollTop = p.top + (el.scrollHeight - p.height);
  }, [prependTick]);

  // Forward: cola no fim se o usuario ja esta la; senao arma o badge.
  useEffect(() => {
    if (didPrependRef.current) { didPrependRef.current = false; return; }
    const el = scrollRef.current;
    if (!el || lines.length === 0) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
    else setHasNew(true);
  }, [lines, prependTick]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_EPSILON_PX;
    stickRef.current = atBottom;
    if (atBottom) setHasNew(false);
  };

  const onLoadMore = () => {
    const el = scrollRef.current;
    if (el) preserveRef.current = { height: el.scrollHeight, top: el.scrollTop };
    loadMore();
  };

  const jumpToEnd = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setHasNew(false);
  };

  const turns = groupTurns(lines);

  const toggleMd = () => {
    const next = !md;
    setMd(next);
    writeMdPref(next);
  };

  const setTermMode = (m) => {
    setMode(m);
    writeTermMode(m);
  };

  const toggleTurn = (key) => setOpenTurns((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  return (
    <section className="ck-pane ck-term-pane">
      <div className="ck-pane-h">
        <span className="ck-ico">{'⌨'}</span>
        <span className="ck-pane-name">TERMINAL</span>
        <span className="ck-tagset">
          <span className="ck-tfilter" role="group" aria-label="Modo do espelho">
            <button type="button" className={mode === 'resumo' ? 'on' : ''} onClick={() => setTermMode('resumo')}>resumo</button>
            <button type="button" className={mode === 'completo' ? 'on' : ''} onClick={() => setTermMode('completo')}>completo</button>
          </span>
          {mode === 'completo' && (
            <button
              type="button"
              className="ck-raw-toggle"
              onClick={toggleMd}
              title={md ? 'ver texto cru (raw)' : 'ver markdown'}
            >
              {md ? 'raw' : 'md'}
            </button>
          )}
          <span className="ck-live-tag"><span className="ck-live-dot" />ao vivo</span>
        </span>
      </div>
      <div className="ck-term" ref={scrollRef} onScroll={onScroll}>
        {!atStart && lines.length > 0 && (
          <div className="ck-loadmore-row">
            <button type="button" className="ck-loadmore" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? 'carregando...' : 'carregar mais ↑'}
            </button>
          </div>
        )}
        {atStart && lines.length > 0 && (
          <div className="ck-ln meta"><span className="ck-mk"> </span><span className="ck-bd">- inicio do historico -</span></div>
        )}
        {lines.length === 0 && (
          <div className="ck-ln meta"><span className="ck-bd">aguardando atividade da sessao...</span></div>
        )}
        {turns.map((b, i) => {
          const key = (b.user ? b.user.seq : 'h') + '-' + i;
          // resumo: digest, MENOS o turno vivo (ultimo, sempre aberto pra ver o
          // agora) e os que o usuario abriu manualmente.
          const isLast = i === turns.length - 1;
          const openFull = mode === 'completo' || isLast || openTurns.has(key);
          if (!openFull) {
            return <TurnDigest key={key} block={b} onOpen={() => toggleTurn(key)} />;
          }
          const collapsible = mode === 'resumo' && !isLast && b.user ? () => toggleTurn(key) : null;
          return <Turn key={key} block={b} md={md} onCollapse={collapsible} />;
        })}
      </div>
      {hasNew && (
        <button type="button" className="ck-back-to-live" onClick={jumpToEnd}>
          voltar ao vivo ↓
        </button>
      )}
    </section>
  );
}
