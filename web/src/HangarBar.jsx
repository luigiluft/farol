// FAROL - HANGAR BAR (S4, F5/F5.7/F5.10): strip retratil de 52px na
// base do modo TORRE quando o deck da sala esta fechado. F5.10: cada
// capsula e um MINI-POD da estacao — casco metalico (#1d2630/#2a3742,
// moldura #384757) com VIGIA e o avatar mini deterministico
// (AvatarSprite, export publico de sprites.jsx) DENTRO da janela, LED
// de estado (LedSprite) no casco + CALLSIGN (F7, nome de estrela em
// pixel 8px, label primario) + code 4ch como sufixo dim + nome do projeto
// na cor (--proj-color; override de contraste no tema claro vive no css)
// + micro ticker da acao corrente em frase amigavel (actionPhrase,
// truncada no FIM com ellipsis pelo css). Visual do pod e
// 100% CSS (secao hangar do fleet.css) — sem station-sprites aqui:
// SleepPodSprite e do diorama da sala, nao do hangar. Cargas
// (kind 'tarefa') sao agrupadas num contador unico; total "N em voo" fica
// a direita. Clique = onSelectShip(id) SEMPRE (re-click na mesma capsula
// NAO des-seleciona: TorreView converte re-select em followShip);
// duplo-clique = onFocusShip(id).
// F5.7 (rito de encerramento no DOM): capsula cuja sessao SAIU do payload
// nao desmonta seca — fica retida ~200ms com a classe .hangar-cap-leaving
// (fade + translateY 8px, 160ms, transform/opacity only) e so entao sai.
// Diff por id contra a lista anterior (useRef); sessao que REAPARECE
// durante a saida cancela o leaving (mesma key => mesmo DOM, sem pisca).
// prefers-reduced-motion: sem retencao, remocao seca.
// Contrato de props: { sessions, selectedShip, onSelectShip, onFocusShip }.
// Sem dependencia nova; helpers compartilhados de roomData.js.
// Regras duras: anima SO transform/opacity; payload defensivo (sessions
// null/undefined ou v2 sem currentAction nao quebram); funcoes <50 linhas.
import { useEffect, useRef, useState } from 'react';
import { AvatarSprite, LedSprite } from './sprites.jsx';
import { flightCode, projectColor, rowStatus, activityLabel } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import './fleet.css';

// retencao da capsula removida: cobre a transicao CSS de 160ms com folga
const LEAVE_MS = 200;

// Lista viva defensiva: payload ausente/parcial (null/undefined) vira [].
function liveList(sessions) {
  return Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [];
}

function interactiveList(sessions) {
  return liveList(sessions).filter((s) => s.kind !== 'tarefa');
}

// reduced-motion = saida seca (checado por sync, nao por frame: barato).
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Merge imutavel dos snapshots em saida: remove os que voltaram ao
// payload, mantem os ainda em fade e acrescenta os recem-removidos
// (com o indice original p/ render no lugar certo). Devolve o MESMO
// array quando nada mudou (evita re-render inutil por poll).
function mergeLeaving(old, alive, gone, prev) {
  const kept = old.filter((it) => !alive.has(it.id));
  const fresh = gone
    .filter((s) => !kept.some((it) => it.id === s.id))
    .map((s) => ({ id: s.id, session: s, index: prev.indexOf(s), goneAt: Date.now() }));
  if (fresh.length === 0 && kept.length === old.length) return old;
  return kept.concat(fresh);
}

// F5.7: retem por ~LEAVE_MS as capsulas de sessoes que sairam do payload
// para a animacao de saida rodar antes do desmonte. Diff por sync de
// sessions (nunca por frame). reduced-motion: nada e retido.
function useLeavingCapsules(sessions) {
  const prevRef = useRef([]);
  const [leaving, setLeaving] = useState([]);

  useEffect(() => {
    const curr = interactiveList(sessions);
    const prev = prevRef.current;
    prevRef.current = curr;
    const alive = new Set(curr.map((s) => s.id));
    const gone = prefersReducedMotion() ? [] : prev.filter((s) => !alive.has(s.id));
    setLeaving((old) => mergeLeaving(old, alive, gone, prev));
  }, [sessions]);

  // expira cada snapshot LEAVE_MS depois do gone dele (timer re-armado a
  // cada mudanca da lista; cleanup sempre cancela o timer pendente)
  useEffect(() => {
    if (leaving.length === 0) return undefined;
    const oldest = Math.min(...leaving.map((it) => it.goneAt));
    const wait = Math.max(16, oldest + LEAVE_MS - Date.now());
    const timer = setTimeout(() => {
      const cutoff = Date.now() - LEAVE_MS;
      setLeaving((old) => old.filter((it) => it.goneAt > cutoff));
    }, wait);
    return () => clearTimeout(timer);
  }, [leaving]);

  return leaving;
}

// Lista de exibicao: capsulas vivas + as em saida inseridas perto da
// posicao original (clamp no fim) — a capsula nao teleporta pra fechar.
// Filtra leaving contra os ids vivos: no render ANTES do effect de diff
// rodar, uma sessao que reapareceu existiria nas duas listas (key dupla).
function displayCapsules(interactive, leaving) {
  const out = interactive.map((s) => ({ id: s.id, session: s, leaving: false }));
  const alive = new Set(interactive.map((s) => s.id));
  const sorted = leaving
    .filter((it) => !alive.has(it.id))
    .sort((a, b) => a.index - b.index);
  for (const it of sorted) {
    const at = Math.min(Math.max(it.index, 0), out.length);
    out.splice(at, 0, { id: it.id, session: it.session, leaving: true });
  }
  return out;
}

// Pose do avatar mini por estado da sessao (mesma linguagem da Sala).
function avatarPose(state) {
  if (state === 'ativa') return 'typing';
  if (state === 'ociosa') return 'idle';
  return 'sleep';
}

function HangarCapsule({ session, leaving, isSelected, onSelectShip, onFocusShip }) {
  const color = projectColor(session.project);
  const st = rowStatus(session);
  const ticker = actionPhrase(session);
  const name = `Agente ${callsign(session.id)}, ${session.project || 'sessao'}, ${st.label}`;
  return (
    <button
      type="button"
      className={`hangar-pod${isSelected ? ' is-selected' : ''}${leaving ? ' hangar-cap-leaving' : ''}`}
      style={{ '--pod-color': color }}
      title={ticker || session.promptPreview || ''}
      aria-label={ticker ? `${name}. Agora: ${ticker}` : name}
      aria-hidden={leaving || undefined}
      tabIndex={leaving ? -1 : undefined}
      aria-pressed={isSelected}
      onClick={() => { if (!leaving) onSelectShip(session.id); }}
      onDoubleClick={() => { if (!leaving) onFocusShip(session.id); }}
    >
      <LedSprite state={session.state} width={8} className="hangar-led" />
      <span className="hangar-vigia" aria-hidden="true">
        <AvatarSprite id={session.id} uniform={color} pose={avatarPose(session.state)} width={16} />
      </span>
      <span className="hangar-id">
        <span className="hangar-line">
          <span className="hangar-voo">{callsign(session.id)}</span>
          <span className="hangar-code" title="id da sessao">{flightCode(session.id)}</span>
          <span className="hangar-proj" style={{ '--proj-color': color }}>
            {session.project || 'sessao'}
          </span>
        </span>
        <span className="hangar-ticker">{ticker || st.label.toLowerCase()}</span>
      </span>
    </button>
  );
}

// true quando a strip tem mais pods do que a largura mostra: liga o fade
// do limite direito (sem overflow o fade sumiria um pod a toa).
function useStripOverflow(ref, deps) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return over;
}

export default function HangarBar({ sessions, selectedShip, onSelectShip, onFocusShip }) {
  const list = liveList(sessions);
  const interactive = list.filter((s) => s.kind !== 'tarefa');
  const leaving = useLeavingCapsules(sessions);
  const pods = displayCapsules(interactive, leaving);
  const cargoCount = list.length - interactive.length;
  const stripRef = useRef(null);
  const overflowing = useStripOverflow(stripRef, [pods.length]);
  return (
    <div className="hangar-bar" role="toolbar" aria-label="Base de subagentes">
      <div ref={stripRef} className={`hangar-strip${overflowing ? ' is-overflowing' : ''}`}>
        {pods.map((pod) => (
          <HangarCapsule
            key={pod.id}
            session={pod.session}
            leaving={pod.leaving}
            isSelected={!pod.leaving && selectedShip === pod.id}
            onSelectShip={onSelectShip}
            onFocusShip={onFocusShip}
          />
        ))}
        {cargoCount > 0 ? (
          <span
            className="hangar-cargo"
            title="execucoes automaticas one-shot (sem conversa)"
            aria-label={`${cargoCount} tarefas automaticas em processamento`}
          >
            {`⛟ ${cargoCount} tarefa${cargoCount > 1 ? 's' : ''}`}
          </span>
        ) : null}
        {Array.isArray(sessions) && list.length === 0 && leaving.length === 0 ? (
          <span className="hangar-empty">nenhum agente nas ultimas 4h — abra uma sessao do Claude Code e a nave aparece aqui</span>
        ) : null}
      </div>
      <span className="hangar-total" aria-label="agentes trabalhando e esperando agora">
        {Array.isArray(sessions) ? activityLabel(list) : 'sync...'}
      </span>
    </div>
  );
}
