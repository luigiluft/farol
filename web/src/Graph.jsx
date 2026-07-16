// FAROL - Graph.jsx (A2, F3+F4; W3 na F5): grafo-universo em canvas 2D.
// O vault e um universo: cada pasta PARA vira uma galaxia com nucleo-sol
// (glow radial na cor do grupo) e cada nota vira um planeta em orbita
// deterministica (seed = hash do path). Brilho da nota = recencia real do
// mtimeMs. Fundo: nebulosas baked + starfield 3 camadas + poeira estelar.
// Contrato com o integrador (A4/F5): props { scope, path, onOpen, embedded,
// onReady, sessions?, onShipSelect?, fitZoom? }. embedded esconde busca/
// legenda/hud mantendo zoom/pan/hover/click/tooltip. fitZoom>1 e um
// VIEWPORT (janela da estacao): aproxima o zoom-to-fit pra as galaxias
// preencherem o vidro em vez de caberem inteiras num strip baixo.
// sessions (opcional, F5) alimenta a
// FROTA: 1 nave por sessao Claude pairando sobre a regiao de trabalho; SEM
// a prop a frota fica vazia com custo ~zero (views NOTA/GRAFO intactas).
// onShipSelect(sessionId) dispara no click da nave (ref estavel, padrao do
// onOpen). No scope global (F5.8/F7) o fetch e paralelo: /api/graph +
// /api/mcp + /api/skills via Promise.all, com catch => null/[] nos extras
// — falha de MCP/skills NUNCA bloqueia nem quebra o universo, so nasce
// sem estacoes/biblioteca. Os MCPs viram satelites orbitando a estacao
// cerebral e as skills viram livros da BIBLIOTECA orbital
// (buildGlobalUniverse(raw, mcps, skills); hover informa, click no
// satelite/livro e no-op, click no nucleo mergulha no hub).
// F7: onThemeChange recria o engine (mesmo pipeline do payload novo) —
// os sprites baked sao cacheados por tema e o canvas renasce na paleta
// certa sem refetch.
// onReady(api) entrega UMA api imperativa estavel:
//   api.worldToScreen(nodeId) -> {x, y, onScreen} | null (px do container)
//   api.highlight(nodeId, {color, ttlMs}) -> bool (flare halo + anel)
//   api.focus(nodeId, {zoom}) -> bool (anima camera ate o no)
//   api.fitView() -> bool (zoom-to-fit: reenquadra todo o universo; tecla
//     'f'/'0' faz o mesmo)
//   api.getViewport() -> {x, y, scale} | null
//   api.hasNode(nodeId) -> bool (no existe no payload atual?)
//   api.shipScreenPoint(sessionId) -> {x, y, k, onScreen} | null
//   api.listShipPoints() -> [{id, x, y, k, onScreen, state, color}] | null
//     (null = engine morto/sem viewport; o overlay pausa o rAF dele)
//   api.followShip(sessionId|null) -> bool (camera segue a nave; null solta;
//     drag real ou wheel tambem soltam; click simples nao)
//   api.setHoverShip(sessionId|null) -> bool (FB: abre o leque de drones
//     rotulado da nave em hover no canvas; null fecha)
// nodeId = path relativo do vault (aceita \ ou /, case-insensitive).
// A api sobrevive a reloads do payload; retorna null/false sem engine.
// Modulos irmaos (ownership A2): graph-universe.js (modelo + sprites),
// graph-engine.js (camera/interacao/rAF/frota), graph-draw.js (render),
// fleet-model.js (estado da frota, W1), fleet-draw.js (render frota, W2).
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, onVaultPing } from './api.js';
import {
  GROUP_STYLES, baseName, buildGlobalUniverse, buildLocalUniverse,
  colorForGroup, groupOf,
} from './graph-universe.js';
import {
  addFlare, createEngine, destroyEngine, engineViewport, fitView, focusNote,
  hasEngineNode, listShipPoints, nodeScreenPoint, setEngineActiveNodes, setEngineSearch,
  setEngineSessions, setFollowShip, setHoverShip, shipScreenPoint,
} from './graph-engine.js';
import { projectColor } from './roomData.js';
import { onThemeChange } from './theme.js';
import './graph.css';

// ----------------------------------------------------------------- hooks

// Busca o payload do grafo; com wantExtras (scope global, F5.8/F7) busca
// /api/mcp e /api/skills em paralelo no mesmo Promise.all. Os catches
// devolvem null/[]: zero estacoes/livros, o universo nunca bloqueia nem
// quebra por MCP ou skills.
function useGraphData(url, wantExtras, attempt) {
  const [fetchState, setFetchState] = useState({
    data: null, mcps: null, skills: null, error: null, loading: true,
  });
  useEffect(() => {
    let alive = true;
    setFetchState({ data: null, mcps: null, skills: null, error: null, loading: true });
    const mcpsReq = wantExtras ? fetchJson('/api/mcp').catch(() => null) : Promise.resolve(null);
    const skillsReq = wantExtras ? fetchJson('/api/skills').catch(() => []) : Promise.resolve([]);
    Promise.all([fetchJson(url), mcpsReq, skillsReq])
      .then(([data, mcps, skills]) => {
        if (alive) setFetchState({ data, mcps, skills, error: null, loading: false });
      })
      .catch((error) => {
        if (alive) {
          setFetchState({ data: null, mcps: null, skills: null, error, loading: false });
        }
      });
    return () => { alive = false; };
  }, [url, wantExtras, attempt]);
  return fetchState;
}

// Tick de tema (F7): incrementa a cada troca de tema; entra nas deps do
// engine para recria-lo com os sprites do tema novo (onThemeChange
// devolve o unsubscribe — cleanup natural do effect).
function useThemeTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => onThemeChange(() => setTick((t) => t + 1)), []);
  return tick;
}

// Conjunto de refs estaveis compartilhadas entre os hooks do componente.
// sessions.current = undefined significa "view sem frota" (NOTA/GRAFO):
// nenhum setEngineSessions e chamado, nem na recriacao do engine.
function useGraphRefs(onOpen, onReady, onShipSelect, fitZoom) {
  const refs = useRef(null);
  if (!refs.current) {
    refs.current = {
      container: { current: null },
      canvas: { current: null },
      tooltip: { current: null },
      engine: { current: null },
      onOpen: { current: onOpen },
      onReady: { current: onReady },
      onShipSelect: { current: onShipSelect },
      sessions: { current: undefined },
      announced: { current: null },
      query: { current: '' },
      links: { current: true },
      fitZoom: { current: fitZoom },
      fitK: { current: null }, // k do fit capturado na criacao do engine (repouso)
    };
    refs.current.api = makeUniverseApi(refs.current);
  }
  refs.current.onOpen.current = onOpen;
  refs.current.onReady.current = onReady;
  refs.current.onShipSelect.current = onShipSelect;
  refs.current.fitZoom.current = fitZoom;
  return refs.current;
}

// API imperativa do universo (contrato F4+F5 com o modo TORRE): objeto
// unico criado uma vez; cada chamada resolve o engine vivo naquele momento,
// entao a api sobrevive a recriacoes do engine (reload do payload). As
// entradas de frota (F5) devolvem null/false sem engine; o FleetOverlay
// usa listShipPoints() null como sinal de pausa do rAF proprio.
function makeUniverseApi(refs) {
  const live = () => refs.engine.current;
  return {
    worldToScreen: (id) => (live() ? nodeScreenPoint(live(), id) : null),
    highlight: (id, opts) => (live() ? addFlare(live(), id, opts) : false),
    focus: (id, opts) => (live() ? focusNote(live(), id, opts) : false),
    getViewport: () => (live() ? engineViewport(live()) : null),
    fitView: () => (live() ? fitView(live()) : false),
    hasNode: (id) => (live() ? hasEngineNode(live(), id) : false),
    shipScreenPoint: (id) => (live() ? shipScreenPoint(live(), id) : null),
    listShipPoints: () => (live() ? listShipPoints(live()) : null),
    followShip: (id) => {
      const eng = live();
      if (!eng) return false;
      setFollowShip(eng, id);
      return true;
    },
    setHoverShip: (id) => {
      const eng = live();
      if (!eng) return false;
      setHoverShip(eng, id);
      return true;
    },
    setActiveNodes: (ids) => {
      const eng = live();
      if (!eng) return false;
      setEngineActiveNodes(eng, ids);
      return true;
    },
  };
}

// onReady dispara quando existe engine; reanuncia so se o callback mudar
// (a api em si e sempre o mesmo objeto).
function announceReady(refs) {
  const cb = refs.onReady.current;
  if (typeof cb !== 'function' || refs.announced.current === cb) return;
  refs.announced.current = cb;
  cb(refs.api);
}

// Ciclo de vida do engine: 1 engine por payload, fora do render do React.
// mcps (F5.8) e skills (F7) chegam junto do data (mesmo fetch) e viram as
// estacoes de servico e a biblioteca do universo global; null = sem
// estacoes/livros, nunca quebra. themeTick (F7) recria o engine na troca
// de tema (mesmo pipeline do payload novo).
function useUniverseEngine(refs, opts) {
  const { data, mcps, skills, hasNodes, isLocal, path, themeTick } = opts;
  useEffect(() => {
    if (!hasNodes || !refs.canvas.current || !refs.container.current) return undefined;
    const universe = isLocal
      ? buildLocalUniverse(data, path)
      : buildGlobalUniverse(data, mcps, skills);
    const engine = createEngine({
      canvas: refs.canvas.current,
      container: refs.container.current,
      tooltipEl: refs.tooltip.current,
      universe,
      showLinks: refs.links.current,
      colorOf: projectColor,
      fitZoom: refs.fitZoom.current,
      onOpen: (p) => {
        if (typeof refs.onOpen.current === 'function') refs.onOpen.current(p);
      },
      onShipSelect: (id) => {
        if (typeof refs.onShipSelect.current === 'function') refs.onShipSelect.current(id);
      },
    });
    if (refs.query.current) setEngineSearch(engine, refs.query.current);
    // Recriacao do engine (payload novo): re-injeta as sessions correntes
    // logo apos criar; a frota renasce seeded, sem chuva de runs.
    if (refs.sessions.current !== undefined) setEngineSessions(engine, refs.sessions.current);
    refs.engine.current = engine;
    // baseline de repouso: o k logo apos criar = zoom-to-fit deste viewport
    refs.fitK.current = engineViewport(engine).scale;
    announceReady(refs);
    return () => {
      destroyEngine(engine);
      refs.engine.current = null;
    };
    // refs sao estaveis; o engine depende do payload (graph+mcp+skills),
    // do centro e do tema corrente (themeTick recria com sprites novos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mcps, skills, hasNodes, isLocal, path, themeTick]);
}

// Refetch AO VIVO quando o vault muda (ping SSE 'vault' via onVaultPing):
// nota nova aparece sem reload e o cometa do graph-fx nasce na hora. O
// rebuild RECRIA o engine (camera volta ao fit), entao so aplica com a
// camera EM REPOUSO (k ate ~1.35x do fit); em mergulho o ping fica
// PENDENTE e aplica quando a camera volta (poll barato 3s). Throttle 20s
// entre refetches — vault de sessao ativa muda o tempo todo.
const VAULT_REFETCH_MIN_MS = 20000;
const VAULT_REST_TOLERANCE = 1.35;
const VAULT_PENDING_POLL_MS = 3000;

function useVaultRefetch(refs, setAttempt) {
  useEffect(() => {
    let pending = false;
    let lastAt = 0;

    const atRest = () => {
      const eng = refs.engine.current;
      const fitK = refs.fitK.current;
      if (!eng || !Number.isFinite(fitK) || fitK <= 0) return false;
      return engineViewport(eng).scale <= fitK * VAULT_REST_TOLERANCE;
    };
    const tryApply = () => {
      if (!pending) return;
      if (Date.now() - lastAt < VAULT_REFETCH_MIN_MS || !atRest()) return;
      pending = false;
      lastAt = Date.now();
      setAttempt((a) => a + 1);
    };
    const off = onVaultPing(() => { pending = true; tryApply(); });
    const poll = setInterval(tryApply, VAULT_PENDING_POLL_MS);
    return () => { off(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Frota (F5): injeta as sessions no engine quando a prop muda. Views sem
// a prop (sessions === undefined) nunca sincronizam — frota vazia, custo
// ~zero. sessions null (SSE ainda carregando) e guardado mas nao sincroniza
// (guard do proprio setEngineSessions).
function useEngineSessions(refs, sessions) {
  useEffect(() => {
    refs.sessions.current = sessions;
    if (sessions === undefined) return;
    if (refs.engine.current) setEngineSessions(refs.engine.current, sessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);
}

function useEngineSearch(refs, query) {
  useEffect(() => {
    refs.query.current = query;
    if (refs.engine.current) setEngineSearch(refs.engine.current, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
}

function useEngineLinks(refs, showLinks) {
  useEffect(() => {
    refs.links.current = showLinks;
    if (refs.engine.current) {
      refs.engine.current.showLinks = showLinks;
      refs.engine.current.dirty = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLinks]);
}

function universeCounts(data) {
  if (!data || !Array.isArray(data.nodes)) return { notes: 0, galaxies: 0 };
  const rows = data.nodes.filter((n) => n.id !== 'VAULT' && n.id !== n.group);
  return {
    notes: rows.length,
    galaxies: new Set(rows.map(groupOf)).size,
  };
}

// ------------------------------------------------------------- componente

export default function Graph({
  scope = 'global', path = null, onOpen, onReady, embedded = false,
  sessions, onShipSelect, fitZoom = 1,
}) {
  const refs = useGraphRefs(onOpen, onReady, onShipSelect, fitZoom);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [showLinks, setShowLinks] = useState(true);

  const isLocal = scope === 'local' && Boolean(path);
  const url = isLocal
    ? `/api/graph?scope=local&path=${encodeURIComponent(path)}&depth=2`
    : '/api/graph?scope=global';
  const { data, mcps, skills, error, loading } = useGraphData(url, !isLocal, attempt);
  useVaultRefetch(refs, setAttempt);
  const themeTick = useThemeTick();
  const counts = useMemo(() => universeCounts(data), [data]);
  const hasNodes = counts.notes > 0;

  useUniverseEngine(refs, { data, mcps, skills, hasNodes, isLocal, path, themeTick });
  useEngineSessions(refs, sessions);
  useEngineSearch(refs, query);
  useEngineLinks(refs, showLinks);

  const canLocate = useMemo(
    () => Boolean(!isLocal && path && hasNodes && data.nodes.some((n) => n.id === path)),
    [data, hasNodes, isLocal, path],
  );

  return (
    <GraphShell
      refs={refs}
      hasNodes={hasNodes}
      isLocal={isLocal}
      path={path}
      embedded={embedded}
      counts={counts}
      query={query}
      setQuery={setQuery}
      showLinks={showLinks}
      setShowLinks={setShowLinks}
      canLocate={canLocate}
      loading={loading}
      error={error}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

function GraphShell(props) {
  const { refs, hasNodes, isLocal, path, embedded, counts, loading, error, onRetry } = props;
  return (
    <div ref={refs.container} className={'graph-root' + (embedded ? ' embedded' : '')}>
      {hasNodes && <canvas ref={refs.canvas} className="graph-canvas" />}
      <div className="graph-vignette" />
      {hasNodes && !embedded && (
        <div className="graph-hud">
          {isLocal
            ? `sistema local: ${baseName(path)}`
            : `universo · ${counts.notes} notas · ${counts.galaxies} galáxias`}
        </div>
      )}
      {hasNodes && !embedded && (
        <GraphControls
          query={props.query}
          setQuery={props.setQuery}
          showLinks={props.showLinks}
          setShowLinks={props.setShowLinks}
          canLocate={props.canLocate}
          onLocate={() => refs.engine.current && focusNote(refs.engine.current, path)}
          onFit={() => refs.engine.current && fitView(refs.engine.current)}
        />
      )}
      {hasNodes && !embedded && isLocal && <GraphLegend />}
      <div className="graph-tooltip" ref={refs.tooltip}>
        <div className="graph-tt-title" />
        <div className="graph-tt-meta" />
        <div className="graph-tt-sub" />
      </div>
      {loading && <GraphLoading />}
      {!loading && error && <GraphError message={error.message} onRetry={onRetry} />}
      {!loading && !error && !hasNodes && <GraphEmpty />}
    </div>
  );
}

function GraphControls({ query, setQuery, showLinks, setShowLinks, canLocate, onLocate, onFit }) {
  return (
    <div className="graph-controls">
      <input
        className="graph-search"
        type="search"
        value={query}
        placeholder="farol: achar estrela"
        aria-label="Buscar nota no universo"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
      />
      <button
        type="button"
        className={'graph-toggle' + (showLinks ? ' on' : '')}
        aria-pressed={showLinks}
        title={showLinks ? 'esconder constelações' : 'mostrar constelações'}
        onClick={() => setShowLinks((v) => !v)}
      >
        constelações
      </button>
      <button
        type="button"
        className="graph-toggle"
        title="reenquadrar todo o universo (tecla f)"
        onClick={onFit}
      >
        reenquadrar
      </button>
      {canLocate && (
        <button type="button" className="graph-toggle" onClick={onLocate}>
          localizar nota
        </button>
      )}
    </div>
  );
}

// Dot na MESMA cor dos nos do tema corrente (colorForGroup resolve
// lightColor, F7): o themeTick do pai re-renderiza a legenda na troca.
function GraphLegend() {
  return (
    <div className="graph-legend">
      {GROUP_STYLES.map((g) => (
        <span key={g.key} className="graph-legend-item">
          <i className="graph-legend-dot" style={{ background: colorForGroup(g.key) }} />
          {g.label}
        </span>
      ))}
    </div>
  );
}

function GraphLoading() {
  return (
    <div className="graph-state">
      <div className="graph-radar">
        <span className="graph-radar-sweep" />
      </div>
      <p className="graph-state-text">mapeando o universo...</p>
    </div>
  );
}

function GraphError({ message, onRetry }) {
  return (
    <div className="graph-state">
      <p className="graph-state-text graph-state-error">falha ao carregar o universo</p>
      <p className="graph-state-detail">{message}</p>
      <button type="button" className="graph-retry" onClick={onRetry}>
        tentar de novo
      </button>
    </div>
  );
}

function GraphEmpty() {
  return (
    <div className="graph-state">
      <p className="graph-state-text">nenhuma conexao por aqui</p>
      <p className="graph-state-detail">o universo aparece quando as notas se ligam</p>
    </div>
  );
}
