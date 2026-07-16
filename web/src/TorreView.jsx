// FAROL - MODO TORRE (W5, F5): universo full-bleed com a FROTA VIVA
// renderizada DENTRO do canvas (W1-W3) + overlay DOM de chips/cartao de
// missao (FleetOverlay, W4) + base retratil: deck da sala OU hangar bar
// (HangarBar), alternados pelo botao SALA/HANGAR (persistido em
// localStorage 'torre.deck', default fechado = hangar) + mini painel de
// voos no topo-direita + dossie. As sondas DOM do F4 (useProbes/
// useActionDiff/ProbeSprite/EdgeArrow/FxLayer/chips/anchors) MORRERAM:
// o canvas assume 100% do teatro diegetico.
// Contratos consumidos (com guard, vizinhos rodam em paralelo):
// - Graph: props embedded + sessions + onShipSelect + onReady(api); a api
//   pode ser parcial (focus/followShip checados antes de chamar);
// - FleetOverlay: props da SPEC F5.4 (sessions/apiRef/selectedShip/...);
// - Room: aceita props extras sem quebrar (sem onDeskMount no F5).
// Duplo-select da mesma nave (Graph, overlay OU hangar) = followShip.
// Regras duras: DOM anima SO transform/opacity; payload v2 sem
// currentAction nao quebra nada; funcoes <50 linhas.
import { useCallback, useRef, useState } from 'react';
import Graph from './Graph.jsx';
import Sphere from './Sphere.jsx';
import Room from './Room.jsx';
import Dossier from './Dossier.jsx';
import FleetOverlay from './FleetOverlay.jsx';
import WorkParticles from './WorkParticles.jsx';
import HangarBar from './HangarBar.jsx';
import MiniAvatar from './MiniAvatar.jsx';
import HudChips from './HudChips.jsx';
import PerfHud from './PerfHud.jsx';
import Rail from './Rail.jsx';
import {
  useSessions, projectColor, flightCode, rowStatus, fmtTokens, activityLabel, agentCounts,
} from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import './torre-view.css';

const FLIGHTS_MAX_ROWS = 9;
const SPHERE_KEY = 'torre.sphere'; // refactor v2: 'off' = universo antigo intacto
const DECK_STORAGE_KEY = 'torre.deck';

function readSphereOn() {
  try {
    return localStorage.getItem(SPHERE_KEY) !== 'off';
  } catch {
    return true;
  }
}
const DECK_H_KEY = 'torre.deckH';
const FLIGHTS_KEY = 'torre.flights';
const DECK_H_DEFAULT = 30;
const DECK_H_MIN = 14;
const DECK_H_MAX = 78;
const DECK_H_STEP = 5; // setas do teclado no separador

// ------------------------------------------------------------------
// persistencia das preferencias (storage pode estar bloqueado)
// ------------------------------------------------------------------

function readDeckOpen() {
  try {
    return localStorage.getItem(DECK_STORAGE_KEY) === 'open';
  } catch {
    return false;
  }
}

function writeDeckOpen(open) {
  try {
    localStorage.setItem(DECK_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // storage indisponivel: preferencia simplesmente nao persiste
  }
}

function clampDeckPct(p) {
  if (!Number.isFinite(p)) return DECK_H_DEFAULT;
  return Math.min(DECK_H_MAX, Math.max(DECK_H_MIN, Math.round(p)));
}

function readDeckPct() {
  try {
    return clampDeckPct(parseFloat(localStorage.getItem(DECK_H_KEY)));
  } catch {
    return DECK_H_DEFAULT;
  }
}

function writeDeckPct(p) {
  try {
    localStorage.setItem(DECK_H_KEY, String(p));
  } catch {
    // sem storage, sem persistencia
  }
}

function readFlightsOpen() {
  try {
    return localStorage.getItem(FLIGHTS_KEY) !== 'closed';
  } catch {
    return true;
  }
}

function writeFlightsOpen(open) {
  try {
    localStorage.setItem(FLIGHTS_KEY, open ? 'open' : 'closed');
  } catch {
    // sem storage, sem persistencia
  }
}

// ------------------------------------------------------------------
// redimensionamento do deck: arrastar a alca (pointer = mouse/touch),
// setas no teclado, duplo-clique reseta. Persiste no pointerup.
// ------------------------------------------------------------------

function useDeckResize(rootRef) {
  const [pct, setPct] = useState(readDeckPct);
  const liveRef = useRef(pct);

  const apply = useCallback((p) => {
    const v = clampDeckPct(p);
    liveRef.current = v;
    setPct(v);
    return v;
  }, []);

  const onPointerDown = useCallback((e) => {
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const move = (ev) => {
      apply(((rect.bottom - ev.clientY) / rect.height) * 100);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      writeDeckPct(liveRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [rootRef, apply]);

  const onKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? DECK_H_STEP : -DECK_H_STEP;
    writeDeckPct(apply(liveRef.current + delta));
  }, [apply]);

  const onReset = useCallback(() => {
    writeDeckPct(apply(DECK_H_DEFAULT));
  }, [apply]);

  return { pct, onPointerDown, onKeyDown, onReset };
}

// Alca de redimensionar: barra fina no topo do deck com grip central.
function DeckResizeHandle({ resize }) {
  return (
    <div
      className="deck-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Redimensionar a sala (arraste, setas do teclado, duplo-clique reseta)"
      tabIndex={0}
      title="Arrastar para aumentar/diminuir a sala · duplo-clique reseta"
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
      onDoubleClick={resize.onReset}
    >
      <span className="deck-resize-grip" aria-hidden="true" />
    </div>
  );
}

// ------------------------------------------------------------------
// mini painel de voos (overlay topo-direita): linhas clicaveis -> dossie
// ------------------------------------------------------------------

function FlightMiniRow({ session, onSelect }) {
  const st = rowStatus(session);
  return (
    <li>
      <button
        type="button"
        className="tf-row"
        title={actionPhrase(session) || session.promptPreview || flightCode(session.id)}
        onClick={() => onSelect({ type: 'session', sessionId: session.id })}
      >
        <span className={`tf-dot ${st.cls}`} />
        <MiniAvatar session={session} width={14} />
        <span className="tf-voo">{callsign(session.id)}</span>
        <span className="tf-dest" style={{ '--proj-color': projectColor(session.project) }}>
          {session.project || 'sessao'}
        </span>
        <span className="tf-tkn">{fmtTokens(session.tokensOut)}</span>
      </button>
    </li>
  );
}

function TorreFlights({ sessions, onSelect }) {
  const [open, setOpen] = useState(readFlightsOpen);
  const list = sessions || [];
  const shown = list.slice(0, FLIGHTS_MAX_ROWS);
  const { working, waiting } = agentCounts(list);

  function toggle(next) {
    writeFlightsOpen(next);
    setOpen(next);
  }

  if (!open) {
    const badge = waiting > 0 ? `${working}+${waiting}` : working;
    return (
      <button
        type="button"
        className="torre-flights-chip"
        title="Expandir o painel de agentes (trabalhando + esperando)"
        onClick={() => toggle(true)}
      >
        agentes · {sessions !== null ? badge : '...'}
      </button>
    );
  }
  return (
    <aside className="torre-flights" aria-label="Painel compacto de agentes">
      <header className="tf-head">
        <span className="tf-title" title="sessoes Claude Code; clique numa linha para abrir os detalhes">
          agentes
        </span>
        <span className="tf-meta">{sessions !== null ? activityLabel(list) : 'sync...'}</span>
        <button
          type="button"
          className="tf-collapse"
          title="Recolher o painel (mais espaco pro universo)"
          aria-label="Recolher painel de agentes"
          onClick={() => toggle(false)}
        >
          »
        </button>
      </header>
      <ol className="tf-list">
        {shown.map((s) => <FlightMiniRow key={s.id} session={s} onSelect={onSelect} />)}
      </ol>
      {list.length > shown.length ? (
        <div className="tf-more">+{list.length - shown.length} agentes</div>
      ) : null}
      {sessions !== null && list.length === 0 ? (
        <div className="tf-more">nenhum agente nas ultimas 4h</div>
      ) : null}
    </aside>
  );
}

// ------------------------------------------------------------------
// view principal
// ------------------------------------------------------------------

// onGoView e OPCIONAL: o orquestrador (App renderCenterView) fia igual ja faz
// no Comando (onGoView={onGoView} -> setView). Sem a prop, o botao "explorar"
// do HUD nao aparece (guard no HudChips); a FILA "esperando voce" independe dela.
export default function TorreView({ onOpenNote, onGoView }) {
  const { sessions } = useSessions();
  const apiRef = useRef(null);
  const sphereApiRef = useRef(null); // ponte rail->esfera (pulsePath/focusPath)
  const rootRef = useRef(null);
  const selectedShipRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [selectedShip, setSelectedShip] = useState(null);
  const [deckOpen, setDeckOpen] = useState(readDeckOpen);
  const resize = useDeckResize(rootRef);

  const handleReady = useCallback((api) => {
    apiRef.current = api || null;
  }, []);

  // FB: o leque de drones segue o HOVER (nao a selecao); o hover e disparado
  // pelos chips do FleetOverlay via apiRef.setHoverShip. Click abre o cartao.
  const handleHoverShip = useCallback((id) => {
    const api = apiRef.current;
    if (api && typeof api.setHoverShip === 'function') api.setHoverShip(id || null);
  }, []);

  // Handler UNICO de selecao de nave (Graph.onShipSelect, overlay e hangar
  // convergem aqui): selecionar de novo a mesma nave = seguir (followShip).
  const handleShipSelect = useCallback((id) => {
    if (id && selectedShipRef.current === id) {
      const api = apiRef.current;
      if (api && typeof api.followShip === 'function') api.followShip(id);
      return;
    }
    selectedShipRef.current = id || null;
    setSelectedShip(id || null);
  }, []);

  const handleFocusShip = useCallback((id) => {
    const api = apiRef.current;
    if (api && typeof api.followShip === 'function') api.followShip(id);
  }, []);

  const handleFocusNode = useCallback((p) => {
    const api = apiRef.current;
    if (api && typeof api.focus === 'function') api.focus(p, {});
  }, []);

  const toggleDeck = useCallback(() => {
    setDeckOpen((prev) => {
      writeDeckOpen(!prev);
      return !prev;
    });
  }, []);

  const sphereOn = readSphereOn();

  return (
    <div className="torre-root" ref={rootRef}>
      <div className={`torre-universe${sphereOn ? ' with-rail' : ''}`}>
        {sphereOn ? (
          <Sphere sessions={sessions} onOpenNote={onOpenNote} apiRef={sphereApiRef} />
        ) : (
          <Graph
            scope="global"
            embedded
            onOpen={onOpenNote}
            onReady={handleReady}
            sessions={sessions}
            onShipSelect={handleShipSelect}
          />
        )}
      </div>
      {sphereOn ? null : <WorkParticles sessions={sessions} apiRef={apiRef} follow />}
      {/* modo esfera: o RAIL responde tudo (agora/movimentos/consumo/esteira/
          maquina) e substitui os overlays historicos; universo antigo mantem */}
      {sphereOn ? (
        <Rail
          sessions={sessions}
          onSelect={setSelected}
          onOpenNote={onOpenNote}
          sphereApi={sphereApiRef}
        />
      ) : (
        <>
          <PerfHud />
          <div className="torre-hud">
            <HudChips
              sessions={sessions}
              waitQueue={sessions}
              onSelect={setSelected}
              onGoView={onGoView}
            />
          </div>
        </>
      )}
      {sphereOn ? null : (
        <FleetOverlay
          sessions={sessions}
          apiRef={apiRef}
          selectedShip={selectedShip}
          onSelectShip={handleShipSelect}
          onHoverShip={handleHoverShip}
          onOpenDossier={setSelected}
          onOpenNote={onOpenNote}
          onFocusNode={handleFocusNode}
        />
      )}
      {/* deck/hangar so no universo antigo: no CEREBRO o rail AGORA ja cobre
          as sessoes e o palco fica limpo (Sala segue acessivel pela nav) */}
      {sphereOn ? null : deckOpen ? (
        <div className="torre-deck" style={{ height: `${resize.pct}%` }}>
          <DeckResizeHandle resize={resize} />
          <div className="torre-deck-tilt">
            <Room onSelect={setSelected} />
          </div>
        </div>
      ) : (
        <HangarBar
          sessions={sessions}
          selectedShip={selectedShip}
          onSelectShip={handleShipSelect}
          onFocusShip={handleFocusShip}
        />
      )}
      {sphereOn ? null : (
        <button
          type="button"
          className="torre-deck-toggle"
          onClick={toggleDeck}
          aria-label={deckOpen ? 'Fechar a sala e mostrar a base de subagentes' : 'Abrir a sala de comando'}
        >
          {deckOpen ? 'BASE' : 'SALA'}
        </button>
      )}
      {sphereOn ? null : <TorreFlights sessions={sessions} onSelect={setSelected} />}
      <Dossier
        selected={selected}
        sessions={sessions}
        apiRef={apiRef}
        onClose={() => setSelected(null)}
        onOpenNote={onOpenNote}
        onSelect={setSelected}
      />
    </div>
  );
}
