// FAROL - DOSSIE (A4, F4): drawer 380px slide-in na direita do modo TORRE.
// Abre no onSelect (sessao OU subagent): avatar grande (gerarAvatar do A3,
// com guard + fallback nos sprites F3 enquanto o contrato nao fecha),
// estado/kind/model, tempo de voo vivo, tokens in/out, transcriptKb, preview
// do prompt, timeline das recentActions (icone por tool, vaultPath clicavel
// -> api.focus no universo), lista de subagents clicaveis (vira dossie do
// subagent) e botoes focar-no-universo / abrir-nota / fechar (Esc fecha).
// F7: identidade por callsign (nome de estrela) com o code 4ch como sufixo
// dim; timeline e acoes em frases amigaveis PT-BR (actionPhrase); subagents
// com droneCallsign + agentType. ToolIcon e exportado para o FleetOverlay
// (mesmo set de icones SVG mono nos dois cartoes).
// Animacao do drawer: transform/opacity only (classe .open).
import { isValidElement, useEffect, useRef, useState } from 'react';
import * as Sprites from './sprites.jsx';
import {
  projectColor, flightCode, shortModel, fmtTokens, flightTime, rowStatus, contextPct,
} from './roomData.js';
import { callsign, droneCallsign, actionPhrase } from './callsigns.js';
import { useBriefing } from './api.js';
import { AgentNarrative, MissionChecklist } from './MissionView.jsx';
import './torre-view.css';

const FILE_TOOLS = new Set(['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit']);

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

function findTarget(selected, sessions) {
  if (!selected || !Array.isArray(sessions)) return null;
  const session = sessions.find((s) => s && s.id === selected.sessionId);
  if (!session) return null;
  if (selected.type === 'subagent') {
    const subs = Array.isArray(session.subagents) ? session.subagents : [];
    const sub = subs.find((x) => x && x.id === selected.subagentId);
    return { session, sub: sub || null };
  }
  return { session, sub: null };
}

// vaultPath mais recente do alvo: currentAction primeiro, depois timeline.
function currentVaultPath(actor) {
  if (!actor) return null;
  if (actor.currentAction && actor.currentAction.vaultPath) {
    return actor.currentAction.vaultPath;
  }
  const recent = Array.isArray(actor.recentActions) ? actor.recentActions : [];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (recent[i] && recent[i].vaultPath) return recent[i].vaultPath;
  }
  return null;
}

function focusNode(apiRef, vaultPath) {
  const api = apiRef ? apiRef.current : null;
  if (!api || typeof api.focus !== 'function' || !vaultPath) return;
  try {
    api.focus(vaultPath, { zoom: 1.6 });
  } catch {
    // api parcial (A2 em paralelo): focar e opcional
  }
}

function fmtClock(ts) {
  const d = new Date(ts || 0);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

// Frase amigavel para uma ACAO avulsa (timeline/log): adapta o shape de
// action para o contrato de actionPhrase (sessao/subagent-like).
export function phraseOfAction(action) {
  if (!action || !action.tool) return null;
  return actionPhrase({ currentAction: action });
}

function toolKind(tool) {
  const t = String(tool || '');
  if (FILE_TOOLS.has(t)) return 'file';
  if (t === 'Bash' || t === 'PowerShell') return 'cmd';
  if (t === 'Grep' || t === 'Glob') return 'search';
  if (t === 'WebFetch' || t === 'WebSearch' || /browser/i.test(t)) return 'web';
  if (t === 'Agent' || /^Task/.test(t)) return 'agent';
  if (t.startsWith('mcp__')) return 'mcp';
  return 'tool';
}

// Avatar via contrato F4 do A3: gerarAvatar(id) devolve os TRAITS
// deterministicos e AvatarSprite/MinionAvatarSprite renderizam. Tudo com
// guard (typeof === 'function') + fallback nos sprites F3, para a view
// nunca quebrar se o contrato mudar.
function buildAvatar(kind, actor, accent) {
  if (kind === 'subagent') {
    if (typeof Sprites.MinionAvatarSprite === 'function') {
      return <Sprites.MinionAvatarSprite label={actor.label || actor.id} width={40} />;
    }
    if (typeof Sprites.DroneSprite === 'function') return <Sprites.DroneSprite width={44} />;
    return null;
  }
  if (typeof Sprites.AvatarSprite === 'function') {
    return <Sprites.AvatarSprite id={actor.id} uniform={accent} pose="idle" width={60} />;
  }
  if (typeof Sprites.gerarAvatar === 'function') {
    try {
      const el = Sprites.gerarAvatar(actor.id);
      if (isValidElement(el)) return el;
    } catch {
      // traits puros (shape atual) caem no fallback abaixo
    }
  }
  if (typeof Sprites.OperatorSprite === 'function') {
    return <Sprites.OperatorSprite pose="idle" tone={accent} width={64} />;
  }
  return null;
}

// ------------------------------------------------------------------
// icones por tool (SVG inline monocromatico, sem emoji)
// ------------------------------------------------------------------

const TOOL_ICON_PATHS = {
  file: <path d="M3.5 12.5 L3.5 9.8 L10 3.3 L12.7 6 L6.2 12.5 Z" />,
  cmd: <path d="M3 4.5 L7.5 8 L3 11.5 M8.5 12 L13 12" />,
  search: <path d="M10.6 10.6 L13.5 13.5 M3 7 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" />,
  web: <path d="M8 2.5 a5.5 5.5 0 1 0 0 11 a5.5 5.5 0 1 0 0 -11 M2.5 8 L13.5 8 M8 2.5 C5.8 5 5.8 11 8 13.5 C10.2 11 10.2 5 8 2.5" />,
  agent: <path d="M5 6 L11 6 L11 11 L5 11 Z M8 6 L8 4 M6.5 13 L6.5 11 M9.5 13 L9.5 11" />,
  mcp: <path d="M8 3 L12.3 5.5 L12.3 10.5 L8 13 L3.7 10.5 L3.7 5.5 Z" />,
  tool: <path d="M4 8 L12 8 M8 4 L8 12" />,
};

export function ToolIcon({ tool, className = 'ds-tool-icon' }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TOOL_ICON_PATHS[toolKind(tool)] || TOOL_ICON_PATHS.tool}
    </svg>
  );
}

// ------------------------------------------------------------------
// blocos do dossie
// ------------------------------------------------------------------

function DossierHeader({ kind, actor, session, accent, onClose }) {
  const st = rowStatus(session);
  const isSub = kind === 'subagent';
  const title = isSub ? (actor.label || actor.id) : (session.project || 'sessao');
  const name = isSub ? droneCallsign(actor.id) : callsign(session.id);
  return (
    <header className="ds-head" style={{ '--ds-accent': accent }}>
      <span className="ds-avatar">{buildAvatar(kind, actor, accent)}</span>
      <span className="ds-id-block">
        <span className="ds-flight">
          {name}
          <span className="ds-code" title="id da sessao">{flightCode(isSub ? actor.id : session.id)}</span>
        </span>
        <span className="ds-project" title={title}>{title}</span>
        <span className="ds-badges">
          <span className={`ds-badge ${st.cls}`}>{st.label}</span>
          <span className="ds-badge">{isSub ? (actor.agentType || 'subagent') : session.kind}</span>
          <span className="ds-badge">{shortModel(session.model)}</span>
        </span>
      </span>
      <button type="button" className="ds-close" title="Fechar dossie (Esc)" onClick={onClose}>
        x
      </button>
    </header>
  );
}

// Celula de contexto: % da janela do modelo em uso, com mini-barra.
function ContextCell({ session }) {
  const pct = contextPct(session);
  if (pct === null) return <dd>--</dd>;
  const level = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
  return (
    <dd className="ds-ctx">
      <span className="ds-ctx-bar">
        <span className={`cpu-fill cpu-${level}`} style={{ transform: `scaleX(${pct / 100})` }} />
      </span>
      {pct}%
    </dd>
  );
}

function DossierStats({ session, now }) {
  const subs = Array.isArray(session.subagents) ? session.subagents : [];
  const subsActive = subs.filter((x) => x && x.active).length;
  const ctxHint = session.contextTokens != null
    ? `${fmtTokens(session.contextTokens)} tokens na janela de contexto do modelo`
    : 'sem dados de contexto ainda';
  return (
    <dl className="ds-stats">
      <div title="ha quanto tempo esta sessao existe">
        <dt>tempo de sessao</dt><dd>{flightTime(session.startedTs, now)}</dd>
      </div>
      <div title={ctxHint}>
        <dt>contexto usado</dt><ContextCell session={session} />
      </div>
      <div title="tokens que a sessao gerou (texto, codigo, tool calls)">
        <dt>tokens gerados</dt><dd>{fmtTokens(session.tokensOut)}</dd>
      </div>
      <div title="tokens novos lidos como entrada (cache nao conta)">
        <dt>tokens lidos</dt><dd>{fmtTokens(session.tokensIn)}</dd>
      </div>
      <div title="ajudantes que este agente despachou (ativos / total recente)">
        <dt>subagentes</dt><dd>{subs.length > 0 ? `${subsActive} ativos / ${subs.length}` : '0'}</dd>
      </div>
      <div title="tamanho do historico completo da conversa em disco">
        <dt>transcript</dt><dd>{session.transcriptKb != null ? `${session.transcriptKb} kb` : '--'}</dd>
      </div>
    </dl>
  );
}

function TimelineItem({ action, apiRef }) {
  const phrase = phraseOfAction(action);
  const raw = action.target ? `${action.tool} > ${action.target}` : String(action.tool || '');
  return (
    <li className="ds-tl-item">
      <span className="ds-tl-time">{fmtClock(action.ts)}</span>
      <ToolIcon tool={action.tool} />
      <span className="ds-tl-text" title={raw}>
        {phrase
          ? <span className="ds-tl-tool">{phrase}</span>
          : (
            <>
              <span className="ds-tl-tool">{action.tool}</span>
              {action.target ? <span className="ds-tl-target"> {action.target}</span> : null}
            </>
          )}
      </span>
      {action.vaultPath ? (
        <button
          type="button"
          className="ds-tl-focus"
          title={`Focar no universo: ${action.vaultPath}`}
          onClick={() => focusNode(apiRef, action.vaultPath)}
        >
          ver
        </button>
      ) : null}
    </li>
  );
}

function DossierTimeline({ session, apiRef }) {
  const recent = Array.isArray(session.recentActions) ? session.recentActions : [];
  const rows = [...recent].reverse();
  return (
    <section className="ds-section">
      <h3 className="ds-section-title" title="passo a passo recente, do mais novo para o mais antigo">
        ultimas acoes
      </h3>
      {rows.length === 0 ? <div className="ds-empty">sem acoes registradas</div> : (
        <ol className="ds-timeline">
          {rows.map((a, i) => (
            <TimelineItem key={`${a.ts || i}#${i}`} action={a} apiRef={apiRef} />
          ))}
        </ol>
      )}
    </section>
  );
}

// Linha de subagente: nome + tipo, a TAREFA que recebeu (label vem da
// description do spawn = o "o que cada um fez") e a acao corrente.
function SubagentRow({ session, sub, onSelect }) {
  const accent = projectColor(session.project);
  const task = sub.label && sub.label !== sub.id ? sub.label : null;
  return (
    <li>
      <button
        type="button"
        className={`ds-sub-row${sub.active ? ' ds-sub-active' : ''}`}
        title={task ? `tarefa: ${task}` : sub.id}
        onClick={() => onSelect({ type: 'subagent', sessionId: session.id, subagentId: sub.id })}
      >
        <span className="ds-sub-avatar">{buildAvatar('subagent', sub, accent)}</span>
        <span className="ds-sub-text">
          <span className="ds-sub-label">
            {droneCallsign(sub.id)}
            <span className="ds-sub-type">{sub.agentType || ''}</span>
          </span>
          {task ? <span className="ds-sub-task">{task}</span> : null}
          <span className="ds-sub-action">
            {sub.active ? (actionPhrase(sub) || 'pensando...') : `terminou · ${actionPhrase(sub) || 'sem acao registrada'}`}
          </span>
        </span>
        <span
          className={`ds-sub-dot${sub.active ? ' on' : ''}`}
          title={sub.active ? 'trabalhando agora' : 'encerrado'}
        />
      </button>
    </li>
  );
}

function DossierSubagents({ session, onSelect }) {
  const subs = Array.isArray(session.subagents) ? session.subagents : [];
  if (subs.length === 0) return null;
  const active = subs.filter((x) => x && x.active).length;
  return (
    <section className="ds-section">
      <h3
        className="ds-section-title"
        title="ajudantes que este agente despachou; clique para ver o detalhe de cada um"
      >
        subagentes ({active > 0 ? `${active} ativos / ${subs.length}` : subs.length})
      </h3>
      <ol className="ds-subs">
        {subs.map((sub) => (
          <SubagentRow key={sub.id} session={session} sub={sub} onSelect={onSelect} />
        ))}
      </ol>
    </section>
  );
}

function DossierFooter({ actor, apiRef, onOpenNote, onClose }) {
  const vp = currentVaultPath(actor);
  return (
    <footer className="ds-footer">
      <button
        type="button"
        className="ds-btn"
        disabled={!vp}
        title={vp ? `Focar ${vp} no universo` : 'sem nota do vault na acao atual'}
        onClick={() => focusNode(apiRef, vp)}
      >
        focar no universo
      </button>
      <button
        type="button"
        className="ds-btn"
        disabled={!vp || typeof onOpenNote !== 'function'}
        title={vp ? `Abrir ${vp}` : 'sem nota do vault na acao atual'}
        onClick={() => vp && onOpenNote(vp)}
      >
        abrir nota
      </button>
      <button type="button" className="ds-btn ds-btn-dim" onClick={onClose}>
        fechar
      </button>
    </footer>
  );
}

function SubagentBody({ session, sub, apiRef, onSelect }) {
  const task = sub.label && sub.label !== sub.id ? sub.label : null;
  return (
    <div className="ds-body">
      {task ? (
        <section className="ds-section">
          <h3 className="ds-section-title" title="o que o agente principal pediu para este subagente">
            tarefa recebida
          </h3>
          <p className="ds-prompt">{task}</p>
        </section>
      ) : null}
      <section className="ds-section">
        <h3 className="ds-section-title" title="o que o subagente esta fazendo, em linguagem dele">
          o que esta fazendo
        </h3>
        {sub.narrative ? <p className="an-lead an-sub">{sub.narrative}</p> : null}
        <div className="ds-action-now ds-action-tool">
          <ToolIcon tool={sub.currentAction ? sub.currentAction.tool : sub.lastTool} />
          <span>{actionPhrase(sub) || 'sem acao recente'}</span>
        </div>
      </section>
      <section className="ds-section">
        <h3 className="ds-section-title">agente principal</h3>
        <button
          type="button"
          className="ds-sub-row"
          onClick={() => onSelect({ type: 'session', sessionId: session.id })}
        >
          <span className="ds-sub-text">
            <span className="ds-sub-label">{callsign(session.id)} {session.project || 'sessao'}</span>
            <span className="ds-sub-action">voltar ao agente que despachou este subagente</span>
          </span>
        </button>
      </section>
      {sub.currentAction && sub.currentAction.vaultPath ? (
        <section className="ds-section">
          <h3 className="ds-section-title">nota do vault</h3>
          <button
            type="button"
            className="ds-vault-link"
            title={sub.currentAction.vaultPath}
            onClick={() => focusNode(apiRef, sub.currentAction.vaultPath)}
          >
            {sub.currentAction.vaultPath}
          </button>
        </section>
      ) : null}
    </div>
  );
}

// Historia da sessao: TODOS os prompts REAIS do operador (userPrompts), do
// primeiro ao ultimo, como timeline visivel (antes so existia no hover do
// localizador). O ultimo = a missao corrente, destacado.
function DossierPrompts({ session }) {
  const prompts = Array.isArray(session.userPrompts)
    ? session.userPrompts.filter((p) => p && String(p).trim())
    : [];
  if (prompts.length < 1) return null;
  return (
    <section className="ds-section">
      <h3 className="ds-section-title" title="tudo que voce pediu nesta sessao, do primeiro ao ultimo">
        seus prompts · {prompts.length}
      </h3>
      <ol className="ds-prompts">
        {prompts.map((p, i) => (
          <li key={`${i}-${String(p).slice(0, 12)}`} className={`ds-prompt-row${i === prompts.length - 1 ? ' latest' : ''}`}>
            <span className="ds-prompt-n">{i + 1}</span>
            <span className="ds-prompt-txt">{p}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionBody({ session, briefing, briefingLoading, apiRef, onSelect, now }) {
  const mission = session.mission || session.promptPreview;
  const hasTasks = Array.isArray(session.tasks) && session.tasks.some((t) => t && t.title);
  return (
    <div className="ds-body">
      {mission ? (
        <section className="ds-section">
          <h3 className="ds-section-title" title="o pedido mais recente do operador nesta sessao">
            missao
          </h3>
          <p className="ds-prompt">{mission}</p>
        </section>
      ) : null}
      <section className="ds-section">
        <h3
          className="ds-section-title"
          title="o que o agente esta fazendo, em linguagem dele (nao a ferramenta crua)"
        >
          o que esta fazendo
        </h3>
        <AgentNarrative session={session} briefing={briefing} loading={briefingLoading} />
        <div className="ds-action-now ds-action-tool" title="ferramenta corrente (passo tecnico)">
          <ToolIcon tool={session.currentAction ? session.currentAction.tool : session.lastTool} />
          <span>{actionPhrase(session) || 'pensando...'}</span>
        </div>
      </section>
      {hasTasks ? (
        <section className="ds-section">
          <h3 className="ds-section-title" title="progresso da missao derivado das tarefas do agente">
            progresso da missao
          </h3>
          <MissionChecklist tasks={session.tasks} />
        </section>
      ) : null}
      <DossierPrompts session={session} />
      <DossierStats session={session} now={now} />
      <DossierTimeline session={session} apiRef={apiRef} />
      <DossierSubagents session={session} onSelect={onSelect} />
    </div>
  );
}

// ------------------------------------------------------------------
// drawer
// ------------------------------------------------------------------

export default function Dossier({ selected, sessions, apiRef, onClose, onOpenNote, onSelect }) {
  const open = Boolean(selected);
  const [now, setNow] = useState(Date.now());
  const lastRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const target = findTarget(selected, sessions);
  if (target) lastRef.current = target; // segura o ultimo snapshot se o voo sumir da janela
  // mantem o conteudo durante o slide-out (open=false) para a saida nao piscar
  const shown = target || lastRef.current;

  // F9: briefing de missao so para SESSAO (subagente usa a narrativa direta do
  // tail). Hook sempre chamado (ordem estavel); id null/closed = inerte.
  const briefId = shown && !shown.sub ? shown.session.id : null;
  const { briefing, loading: briefingLoading } = useBriefing(briefId, open);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') closeRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  if (!shown) {
    return <aside className="torre-dossier" aria-hidden="true" />;
  }

  const kind = shown.sub ? 'subagent' : 'session';
  const actor = shown.sub || shown.session;
  const accent = projectColor(shown.session.project);
  return (
    <aside className={`torre-dossier${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Detalhes do agente">
      <DossierHeader kind={kind} actor={actor} session={shown.session} accent={accent} onClose={onClose} />
      {open && !target ? <div className="ds-stale">sessao encerrada ou fora da janela: dados congelados</div> : null}
      {kind === 'subagent'
        ? <SubagentBody session={shown.session} sub={shown.sub} apiRef={apiRef} onSelect={onSelect} />
        : (
          <SessionBody
            session={shown.session}
            briefing={briefing}
            briefingLoading={briefingLoading}
            apiRef={apiRef}
            onSelect={onSelect}
            now={now}
          />
        )}
      <DossierFooter actor={actor} apiRef={apiRef} onOpenNote={onOpenNote} onClose={onClose} />
    </aside>
  );
}
