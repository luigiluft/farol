// FAROL - SessionLog (F8): LOCALIZADOR DE SESSAO. Substituiu o feed de
// atividade cronologico (ruido) por UM cartao por sessao com o PROMPT mais
// recente do humano + projeto + status — pra se localizar ("em que parte
// estamos, em que projeto"). O historico completo dos prompts vai no title
// (hover). Consome o contexto compartilhado useSessions; zero fetch proprio.
// Clique no cartao abre o dossie (onSelect, igual ao FlightBoard).
import { useSessions, projectColor, rowStatus } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import './room.css';

// Prompt mais recente do humano; cai no promptPreview (v2) ou null.
function latestPrompt(s) {
  const p = Array.isArray(s.userPrompts) ? s.userPrompts : [];
  if (p.length) return p[p.length - 1];
  return s.promptPreview || null;
}

// Historico (mais novo primeiro) pro tooltip; vazio = so o ultimo.
function promptHistory(s) {
  const p = Array.isArray(s.userPrompts) ? s.userPrompts : [];
  if (p.length <= 1) return latestPrompt(s) || '';
  return p.slice().reverse().map((t, i) => `${i + 1}. ${t}`).join('\n');
}

function pressProps(fn) {
  if (!fn) return {};
  return {
    role: 'button',
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    },
  };
}

function SessionCard({ s, onSelect }) {
  const st = rowStatus(s);
  const prompts = Array.isArray(s.userPrompts) ? s.userPrompts : [];
  const latest = latestPrompt(s);
  const action = actionPhrase(s);
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: s.id }) : null;
  return (
    <li className={`slog-card${select ? ' slog-sel' : ''}`} {...pressProps(select)}>
      <div className="slog-head">
        <span className={`slog-dot ${st.cls}`} aria-hidden="true" />
        <span className="slog-name">{callsign(s.id)}</span>
        <span className="slog-proj" style={{ '--proj-color': projectColor(s.project) }}>
          {s.project || 'sessao'}
        </span>
        <span className={`slog-st ${st.cls}`}>{st.label}</span>
      </div>
      <div className="slog-prompt" title={promptHistory(s)}>
        {latest || 'sem prompt registrado'}
      </div>
      {action ? <div className="slog-now" title="acao corrente">▸ {action}</div> : null}
      {prompts.length > 1 ? (
        <div className="slog-more">{prompts.length} prompts · histórico no hover</div>
      ) : null}
    </li>
  );
}

export default function SessionLog({ onSelect }) {
  const { sessions } = useSessions();
  const list = Array.isArray(sessions) ? sessions.filter((s) => s && s.id) : null;
  return (
    <div className="panel slog" aria-label="Localizador de sessoes">
      <header className="slog-header" title="onde voce esta em cada sessao: ultimo prompt + projeto">
        sessões
      </header>
      <ol className="slog-list">
        {(list || []).map((s) => <SessionCard key={s.id} s={s} onSelect={onSelect} />)}
      </ol>
      {list === null ? <div className="slog-empty">sincronizando...</div> : null}
      {list && list.length === 0 ? <div className="slog-empty">nenhuma sessao nas ultimas 4h</div> : null}
    </div>
  );
}
