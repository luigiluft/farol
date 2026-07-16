// FAROL - Cockpit v2 "o olho nunca fica preto". Shell da view: rail de
// chips (missao + dominio + pergunta pendente), banner da sessao em foco
// (pergunta rosa quando esperando + pill de tokens) e o pane direito
// (toggle OLHO|DIFF|TRILHA), que moram em modulos proprios:
// cockpit-terminal.jsx (espelho por TURNOS), cockpit-eye.jsx (olho
// multi-modal com selo de frescor), cockpit-diff.jsx (git status+diff),
// cockpit-trilha.jsx (urls+arquivos citados/produzidos) e cockpit-wall.jsx
// (parede de tiles artefato/agora). Helpers puros: cockpit-model.js.
// Ordenacao do rail: esperando -> pronto -> trabalhando -> ociosa -> dormindo.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useSessions } from './roomData.js';
import { callsign } from './callsigns.js';
import {
  idColor, initials, domainOf, fmtTok, fmtDur, fmtClock, fmtDay,
} from './cockpit-model.js';
import {
  isWaiting, classify, compareRail, waitAge, workAge,
} from './rail-model.js';
import TerminalPane from './cockpit-terminal.jsx';
import EyePane, { doingOf } from './cockpit-eye.jsx';
import FluxoPane from './cockpit-fluxo.jsx';
import EyeWall from './cockpit-wall.jsx';
import './cockpit.css';
import './cockpit-v2.css';

// xterm e ~300KB: carrega LAZY para NAO entrar no bundle inicial do Cockpit.
const LocalTerm = lazy(() => import('./LocalTerm.jsx'));
// DiffPane consome /api/diff (git status+diff): LAZY pelo mesmo motivo.
const DiffPane = lazy(() => import('./cockpit-diff.jsx'));
// TrilhaPane consome /api/ledger + /api/visor + /api/assets: LAZY pelo mesmo motivo.
const TrilhaPane = lazy(() => import('./cockpit-trilha.jsx'));
// GaleriaPane consome /api/assets (Task 7): LAZY pelo mesmo motivo.
const GaleriaPane = lazy(() => import('./cockpit-galeria.jsx'));

const WAIT_TICK_MS = 15000; // relogio do "esperando ha X" (independe do SSE)
const MODE_KEY = 'torre.cockpitMode';
const RIGHT_KEY = 'torre.ckRight';
const LOCAL_ID = 'local';

const MODES = new Set(['foco', 'parede', 'galeria']);

function readMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES.has(v) ? v : 'foco';
  } catch {
    return 'foco';
  }
}

function writeMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, MODES.has(mode) ? mode : 'foco');
  } catch {
    // localStorage indisponivel (modo privado/quota): persistencia best-effort
  }
}

// Toggle do pane direito no modo foco: OLHO (default), FLUXO, DIFF ou TRILHA.
// FLUXO era um 2o "olho" aninhado dentro do olho; virou irmao aqui (uma fila so).
// Migracao: valor persistido desconhecido (versao antiga ou lixo) -> 'olho'.
const RIGHT_PANES = new Set(['olho', 'fluxo', 'diff', 'trilha']);

function readRightPane() {
  try {
    const v = localStorage.getItem(RIGHT_KEY);
    return RIGHT_PANES.has(v) ? v : 'olho';
  } catch {
    return 'olho';
  }
}

function writeRightPane(pane) {
  try {
    localStorage.setItem(RIGHT_KEY, RIGHT_PANES.has(pane) ? pane : 'olho');
  } catch {
    // localStorage indisponivel: persistencia best-effort
  }
}

// Relogio local que avanca sem esperar SSE (payload de awaiting nao muda).
function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// "ha X" desde o fim do turno (lastActivityTs; fallback secondsSinceEvent).
function fmtWait(session, now) {
  const ts = Date.parse((session && session.lastActivityTs) || '');
  let sec;
  if (Number.isFinite(ts)) {
    sec = (now - ts) / 1000;
  } else {
    const sse = Number(session && session.secondsSinceEvent);
    if (!Number.isFinite(sse)) return '';
    sec = sse;
  }
  const v = Math.max(0, Math.round(sec));
  if (v < 60) return 'ha ' + v + 's';
  if (v < 3600) return 'ha ' + Math.floor(v / 60) + 'min';
  if (v < 86400) return 'ha ' + Math.floor(v / 3600) + 'h';
  return 'ha ' + Math.floor(v / 86400) + 'd';
}

// ------------------------------------------------------------------- UI ----

export default function Cockpit() {
  const { sessions } = useSessions();
  const [selId, setSelId] = useState(null);
  const [mode, setMode] = useState(readMode);
  const [rightPane, setRightPane] = useState(readRightPane);
  const [fromWall, setFromWall] = useState(false);
  const now = useNow(WAIT_TICK_MS);
  const list = (Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : [])
    .slice()
    .sort((a, b) => compareRail(a, b, now));
  const hasSessions = list.length > 0;

  // LOCAL e pseudo-id sempre valido mas so vira FOCO por escolha explicita.
  // Default/fallback = 1a sessao da lista ordenada; sem nenhuma, LOCAL.
  const sessionSel = selId && selId !== LOCAL_ID && list.some((s) => s.id === selId) ? selId : null;
  const validSel = selId === LOCAL_ID
    ? LOCAL_ID
    : (sessionSel || (hasSessions ? list[0].id : LOCAL_ID));
  useEffect(() => {
    if (validSel !== LOCAL_ID && validSel !== selId) setSelId(validSel);
  }, [validSel, selId]);

  useEffect(() => { writeMode(mode); }, [mode]);
  useEffect(() => { writeRightPane(rightPane); }, [rightPane]);

  // Esc volta pra parede QUANDO a sessao foi expandida a partir dela.
  useEffect(() => {
    if (mode !== 'foco' || !fromWall) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setMode('parede'); setFromWall(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, fromWall]);

  const isLocal = validSel === LOCAL_ID;
  const selected = isLocal ? null : (list.find((s) => s.id === validSel) || null);
  const color = isLocal ? 'var(--ck-teal)' : (validSel ? idColor(validSel) : 'var(--accent)');

  const goMode = (m) => { setMode(m); setFromWall(false); };
  const expand = (id) => { setSelId(id); setMode('foco'); setFromWall(true); };
  const backToWall = () => { setMode('parede'); setFromWall(false); };
  // "ver diff" do chip PRONTO: seleciona a sessao E abre o pane DIFF (torre.ckRight).
  const openDiff = (id) => { setSelId(id); setRightPane('diff'); };

  const showRightToggle = mode === 'foco' && !isLocal;

  if (mode === 'parede' && !hasSessions) {
    return (
      <div className="cockpit" style={{ '--idc': color }}>
        <CockpitToolbar
          mode={mode}
          onMode={goMode}
          count={0}
          fromWall={fromWall}
          onBack={backToWall}
          rightPane={rightPane}
          onRightPane={setRightPane}
          showRightToggle={false}
        />
        <div className="ck-wall-empty mono">nenhuma sessao viva no momento</div>
      </div>
    );
  }

  return (
    <div className="cockpit" style={{ '--idc': color }}>
      <CockpitToolbar
        mode={mode}
        onMode={goMode}
        count={list.length}
        fromWall={fromWall}
        onBack={backToWall}
        rightPane={rightPane}
        onRightPane={setRightPane}
        showRightToggle={showRightToggle}
      />
      {mode === 'parede' ? (
        <EyeWall sessions={list} onExpand={expand} />
      ) : mode === 'galeria' ? (
        <Suspense fallback={<div className="ck-wall-empty mono">carregando galeria…</div>}>
          <GaleriaPane />
        </Suspense>
      ) : (
        <div className="ck-foco">
          <SessionRail sessions={list} selId={validSel} onSelect={setSelId} onOpenDiff={openDiff} now={now} />
          <div className="ck-main">
            {isLocal ? (
              <>
                <LocalBanner />
                <div className="ck-panes">
                  <LocalTermPane />
                  <EyePlaceholder />
                </div>
              </>
            ) : (
              <>
                <FocusBanner session={selected} color={color} now={now} />
                <div className="ck-panes">
                  <TerminalPane key={validSel} id={validSel} />
                  {rightPane === 'diff' ? (
                    <Suspense fallback={null}>
                      <DiffPane key={'diff-' + validSel} session={selected} />
                    </Suspense>
                  ) : rightPane === 'trilha' ? (
                    <Suspense fallback={null}>
                      <TrilhaPane key={'trilha-' + validSel} session={selected} />
                    </Suspense>
                  ) : rightPane === 'fluxo' ? (
                    <FluxoPane key={'flx-' + validSel} session={selected} />
                  ) : (
                    <EyePane key={'eye-' + validSel} session={selected} color={color} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CockpitToolbar({
  mode, onMode, count, fromWall, onBack, rightPane, onRightPane, showRightToggle,
}) {
  return (
    <div className="ck-topbar">
      <div className="ck-seg" role="group" aria-label="Modo do cockpit">
        <button
          type="button"
          className={'ck-seg-btn' + (mode === 'foco' ? ' on' : '')}
          onClick={() => onMode('foco')}
        >
          foco
        </button>
        <button
          type="button"
          className={'ck-seg-btn' + (mode === 'parede' ? ' on' : '')}
          onClick={() => onMode('parede')}
        >
          parede
        </button>
        <button
          type="button"
          className={'ck-seg-btn' + (mode === 'galeria' ? ' on' : '')}
          onClick={() => onMode('galeria')}
        >
          galeria
        </button>
      </div>
      {showRightToggle && (
        <div className="ck-seg" role="group" aria-label="Pane direito">
          <button
            type="button"
            className={'ck-seg-btn' + (rightPane === 'olho' ? ' on' : '')}
            onClick={() => onRightPane('olho')}
          >
            olho
          </button>
          <button
            type="button"
            className={'ck-seg-btn' + (rightPane === 'fluxo' ? ' on' : '')}
            onClick={() => onRightPane('fluxo')}
          >
            fluxo
          </button>
          <button
            type="button"
            className={'ck-seg-btn' + (rightPane === 'diff' ? ' on' : '')}
            onClick={() => onRightPane('diff')}
          >
            diff
          </button>
          <button
            type="button"
            className={'ck-seg-btn' + (rightPane === 'trilha' ? ' on' : '')}
            onClick={() => onRightPane('trilha')}
          >
            trilha
          </button>
        </div>
      )}
      {mode === 'parede' ? (
        <span className="ck-topbar-hint">parede de olhos - {count} {count === 1 ? 'sessao' : 'sessoes'} - clique num tile pra expandir</span>
      ) : mode === 'galeria' ? (
        <span className="ck-topbar-hint">tudo que a frota gerou e viu — 30 dias</span>
      ) : fromWall ? (
        <button type="button" className="ck-back-wall" onClick={onBack}>voltar a parede (Esc)</button>
      ) : (
        <span className="ck-topbar-hint">o olho da IA por sessao viva</span>
      )}
    </div>
  );
}

function SessionRail({ sessions, selId, onSelect, onOpenDiff, now }) {
  return (
    <aside className="ck-rail">
      <div className="ck-rail-head">
        <span className="ck-rail-title">SESSOES DA FROTA</span>
        <span className="ck-rail-legend">
          <i><span className="ck-lg w" />esperando</i>
          <i><span className="ck-lg p" />pronto</i>
          <i><span className="ck-lg a" />trabalhando</i>
          <i><span className="ck-lg d" />dormindo</i>
        </span>
      </div>
      <div className="ck-chips">
        <LocalChip on={selId === LOCAL_ID} onSelect={onSelect} />
        {sessions.map((s) => (
          <SessionChip
            key={s.id}
            session={s}
            on={s.id === selId}
            onSelect={onSelect}
            onOpenDiff={onOpenDiff}
            now={now}
          />
        ))}
      </div>
    </aside>
  );
}

// Chip fixo do terminal LOCAL interativo: sempre no topo da lista, cor teal.
function LocalChip({ on, onSelect }) {
  return (
    <button
      type="button"
      className={'ck-chip ck-chip-local' + (on ? ' on' : '')}
      style={{ '--idc': 'var(--ck-teal)' }}
      onClick={() => onSelect(LOCAL_ID)}
    >
      <span className="ck-av ck-av-local" aria-hidden="true">{'>_'}</span>
      <span className="ck-c1">
        <span className="ck-cs">LOCAL</span>
        {on && <span className="ck-cur">em foco</span>}
      </span>
      <span className="ck-c2">
        <span className="ck-pj">terminal</span>
        <span className="ck-sep"> - </span>
        <span className="ck-doing">powershell interativo</span>
      </span>
    </button>
  );
}

// Chip v2 (Task 4.3, variante B "Pronto != Esperando"): 4 tratamentos visuais
// distintos no rail. esperando (rosa: tempo GRANDE + pergunta clamp-2) / pronto
// (aco: badge+tempo, resumo narrative, "ver diff") / trabalhando (badge+tempo do
// ultimo prompt, acao corrente) / dormindo (colapsado 1 linha; ociosa idem).
// Tempo em TODOS os estados (pedido do dono). LOCAL segue no LocalChip intacto.
function SessionChip({ session, on, onSelect, onOpenDiff, now }) {
  const color = idColor(session.id);
  const cs = callsign(session.id);
  const kind = classify(session, now);
  const select = () => onSelect(session.id);
  const cls = (variant) => 'ckb-chip ' + variant + (on ? ' on' : '');

  if (kind === 'esperando') {
    return (
      <button type="button" className={cls('ckb-esperando')} style={{ '--idc': color }} onClick={select}>
        <span className="ckb-row1">
          <span className="ckb-cs">{cs}</span>
          <span className="ckb-big-wait">{waitAge(session, now)}</span>
        </span>
        {session.pendingQuestion && <span className="ckb-q">{session.pendingQuestion}</span>}
      </button>
    );
  }

  if (kind === 'pronto') {
    // PRONTO: container NAO-interativo (sem role/tabIndex/onKeyDown) com DOIS
    // <button> IRMAOS — button aninhado dentro de div[role=button] e
    // nested-interactive invalido pra a11y (axe). ckb-main carrega todo o
    // conteudo do chip (callsign, badge, resumo) e faz a selecao; ckb-diffaff
    // e irmao, nao filho, entao nao precisa mais de stopPropagation (o pai
    // nao tem onClick pra vazar).
    return (
      <div className={cls('ckb-pronto ckb-just')} style={{ '--idc': color }}>
        <button type="button" className="ckb-main" onClick={select}>
          <span className="ckb-row1">
            <span className="ckb-cs">{cs}</span>
            <span className="ckb-badge">PRONTO · {waitAge(session, now)}</span>
          </span>
          <span className="ckb-narrative">{session.narrative}</span>
        </button>
        <button type="button" className="ckb-diffaff" onClick={() => onOpenDiff(session.id)}>ver diff ▸</button>
      </div>
    );
  }

  if (kind === 'trabalhando') {
    const age = workAge(session, now);
    return (
      <button type="button" className={cls('ckb-trabalhando')} style={{ '--idc': color }} onClick={select}>
        <span className="ckb-row1">
          <span className="ckb-cs">{cs}</span>
          <span className="ckb-badge">{age ? 'TRABALHANDO · ' + age : 'TRABALHANDO'}</span>
        </span>
        <span className="ckb-doing">{doingOf(session)}</span>
      </button>
    );
  }

  // ociosa | dormindo: colapsado, 1 linha, apagado.
  const label = kind === 'ociosa' ? 'OCIOSA' : 'DORMINDO';
  return (
    <button type="button" className={cls('ckb-dormindo')} style={{ '--idc': color }} onClick={select}>
      <span className="ckb-cs">{cs}</span>
      <span className="ckb-dim-txt">{'· ' + label + ' ' + waitAge(session, now)}</span>
    </button>
  );
}

// Banner v2: identidade + dominio + AGORA (ou a PERGUNTA em rosa) + pill de
// tokens da sessao + hora da ultima atividade.
function FocusBanner({ session, color, now }) {
  if (!session) return <div className="ck-banner" />;
  const cs = callsign(session.id);
  const dom = domainOf(session);
  const waiting = isWaiting(session);
  const tok = (session.tokensIn || 0) + (session.tokensOut || 0);
  const dur = Date.parse(session.lastActivityTs || '') - Date.parse(session.startedTs || '');
  return (
    <div className={'ck-banner' + (waiting ? ' waiting' : '')} style={{ '--idc': color }}>
      <span className="ck-flabel">sessao em foco</span>
      <span className="ck-bav">{initials(cs)}</span>
      <span className="ck-bwho">
        {cs}
        <span className="ck-bpj">{session.project || 'home'}</span>
        <span className="ck-dm" style={{ color: dom.color }}>{dom.label}</span>
      </span>
      {waiting ? (
        <span className="ck-bnow ck-bwait">
          <span className="ck-live-dot" />
          ESPERANDO <b>{fmtWait(session, now)}</b>
          {session.pendingQuestion && (
            <span className="ck-bq">{' — “'}{session.pendingQuestion}{'”'}</span>
          )}
        </span>
      ) : (
        <span className="ck-bnow">
          <span className="ck-live-dot" />
          AGORA: <b>{doingOf(session)}</b>
        </span>
      )}
      <span className="ck-bmeta">
        <span className="ck-tokpill">
          <b>{fmtTok(tok)}</b> tok
          {Number.isFinite(dur) && dur > 0 ? ' · ' + fmtDur(dur) : ''}
        </span>
        <span>
          ultima <b>{fmtClock(session.lastActivityTs) || '--:--'} {fmtDay(session.lastActivityTs)}</b>
        </span>
      </span>
    </div>
  );
}

// Faixa "sessao em foco" do terminal LOCAL (sem sessao real por tras).
function LocalBanner() {
  return (
    <div className="ck-banner ck-banner-local" style={{ '--idc': 'var(--ck-teal)' }}>
      <span className="ck-flabel">sessao em foco</span>
      <span className="ck-bav ck-av-local" aria-hidden="true">{'>_'}</span>
      <span className="ck-bwho">
        LOCAL
        <span className="ck-bpj">terminal interativo</span>
      </span>
      <span className="ck-bnow">
        <span className="ck-live-dot" />
        TERMINAL LOCAL <b>powershell</b>
      </span>
    </div>
  );
}

// Terminal LOCAL no lugar do espelho: LocalPane (PTY xterm) carregado LAZY.
function LocalTermPane() {
  return (
    <section className="ck-pane ck-term-pane ck-local-wrap">
      <Suspense fallback={<div className="ck-local-loading mono">carregando terminal local...</div>}>
        <LocalTerm visible onStatus={() => {}} />
      </Suspense>
    </section>
  );
}

// OLHO nao se aplica ao terminal local (sem browser/CDP): placeholder honesto.
function EyePlaceholder() {
  return (
    <section className="ck-pane ck-eye-pane">
      <div className="ck-pane-h">
        <span className="ck-ico eye">{'◉'}</span>
        <span className="ck-pane-name">OLHO DA IA</span>
        <span className="ck-tag hist">sem olho</span>
      </div>
      <div className="ck-stage">
        <span className="ck-stage-empty">terminal local — sem olho</span>
      </div>
    </section>
  );
}
