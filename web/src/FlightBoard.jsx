// FAROL - PAINEL DE VOOS (A3; extraido de Room.jsx na F3 para
// manter arquivos pequenos). Tabela split-flap estilo aeroporto com
// TODAS as sessoes da janela. Linha nova ou mudanca de STATUS =
// animacao flap por celula com stagger de 30ms (remount via key).
// App importa { FlightBoard } de Room.jsx (re-export preservado).
// F4 (props NOVAS, opcionais - integrador/A4):
// - onSelect({type:'session', sessionId}): linha vira clicavel
//   (clique/Enter) para abrir o dossie no modo TORRE;
// - sessions/error: override de dados (SessionsProvider do A4);
//   quando sessions !== undefined o hook interno NAO roda.
// F7: col VOO mostra o CALLSIGN (nome de estrela) inteiro + code 4ch como
// sufixo dim (.fb-code, estilo em torre-view.css); a largura da coluna e
// contrato do room.css (minmax(64px, max-content)). DESTINO usa a classe
// .fb-proj com --proj-color inline (regra css no room.css): no tema claro
// a cor crua do projeto falha contraste como texto e o override por tema
// resolve no css. O flap re-anima 1x quando o label muda: cosmetico, aceito.
import { useMemo, useRef } from 'react';
import {
  useSessions, projectColor, flightCode, shortModel, fmtTokens, rowStatus, activityLabel,
} from './roomData.js';
import { callsign } from './callsigns.js';
import MiniAvatar from './MiniAvatar.jsx';
import './room.css';

// Colunas autoexplicativas (era VOO/DESTINO/AERONAVE/TKN): cada linha
// e uma sessao do Claude Code = um agente com nome proprio (callsign).
const FB_COLS = ['AGENTE', 'PROJETO', 'MODELO', 'STATUS', 'TOKENS'];

// Mantem um registro {status, seq} por sessao; seq incrementa quando o
// STATUS muda (idempotente para o double-render do StrictMode).
function diffFlights(list, reg) {
  return list.map((s) => {
    const st = rowStatus(s);
    const entry = reg.get(s.id);
    if (!entry) {
      reg.set(s.id, { status: st.label, seq: 0 });
      return { s, st, seq: 0 };
    }
    if (entry.status !== st.label) {
      entry.status = st.label;
      entry.seq += 1;
    }
    return { s, st, seq: entry.seq };
  });
}

// Tooltip por status: explica o criterio de tempo de cada estado.
const STATUS_HINTS = {
  TRABALHANDO: 'agente executando agora (atividade nos ultimos 3 min)',
  'ESPERANDO VOCÊ': 'encerrou o turno e aguarda sua resposta',
  CONCLUÍDO: 'tarefa one-shot terminada',
  OCIOSO: 'sem atividade ha 3-30 min (aguardando voce ou proxima tarefa)',
  DORMINDO: 'sem atividade ha mais de 30 min',
  TAREFA: 'execucao automatica one-shot (sem conversa interativa)',
};

function statusHint(label) {
  return STATUS_HINTS[label] || label;
}

function rowPressProps(fn) {
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

function FlightRow({ row, onSelect }) {
  const { s, st, seq } = row;
  const select = onSelect ? () => onSelect({ type: 'session', sessionId: s.id }) : null;
  const cells = [
    {
      txt: (
        <>
          <MiniAvatar session={s} width={15} />
          {callsign(s.id)}
          <span className="fb-code" title="id da sessao">{flightCode(s.id)}</span>
        </>
      ),
      cls: 'fb-voo',
      title: flightCode(s.id),
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px' },
    },
    {
      txt: s.project || 'sessao',
      cls: 'fb-dest fb-proj',
      style: { '--proj-color': projectColor(s.project) },
    },
    { txt: shortModel(s.model), cls: 'fb-craft', title: s.model || 'modelo n/d' },
    { txt: st.label, cls: st.cls, title: statusHint(st.label) },
    { txt: fmtTokens(s.tokensOut), cls: 'fb-tkn', title: 'tokens gerados pela sessao' },
  ];
  return (
    <li
      className={`fb-row${s.state === 'dormindo' ? ' fb-row-dorm' : ''}${select ? ' fb-row-sel' : ''}`}
      title={s.promptPreview || ''}
      {...rowPressProps(select)}
    >
      {cells.map((c, i) => (
        <span
          key={`${seq}:${i}`}
          className={`fb-cell fb-flap ${c.cls}`}
          title={c.title}
          style={{ animationDelay: `${i * 30}ms`, ...(c.style || {}) }}
        >
          {c.txt}
        </span>
      ))}
    </li>
  );
}

function FlightBoardView({ sessions = null, error = null, onSelect }) {
  const regRef = useRef(new Map());
  const rows = useMemo(() => diffFlights(sessions || [], regRef.current), [sessions]);
  const loaded = sessions !== null;

  return (
    <section className="panel fboard" aria-label="Agentes Claude Code">
      <header className="fb-titlebar">
        <span className="fb-title">agentes</span>
        <span
          className="fb-meta"
          title="sessoes Claude Code das ultimas 4h; clique numa linha para ver os detalhes"
        >
          {loaded ? activityLabel(sessions) : 'sincronizando...'}
        </span>
      </header>
      <div className="fb-row fb-head" aria-hidden="true">
        {FB_COLS.map((c) => <span key={c} className="fb-cell">{c}</span>)}
      </div>
      <ol className="fb-body">
        {rows.map((row) => <FlightRow key={row.s.id} row={row} onSelect={onSelect} />)}
      </ol>
      {loaded && rows.length === 0 ? (
        <div className="fb-empty">nenhum agente nas ultimas 4h</div>
      ) : null}
      {error ? <div className="room-error fb-error">monitor offline: {error}</div> : null}
    </section>
  );
}

// Sem override de sessions, o painel busca sozinho (compat F3).
function FlightBoardSelf(props) {
  const { sessions, error } = useSessions();
  return <FlightBoardView {...props} sessions={sessions} error={error} />;
}

export function FlightBoard(props) {
  if (props && props.sessions !== undefined) return <FlightBoardView {...props} />;
  return <FlightBoardSelf {...(props || {})} />;
}
