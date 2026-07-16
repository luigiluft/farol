// FAROL - shell MOBILE: aba HOJE (Comando do Dia, layout COLUNA aprovado pro
// mobile — nao o bento do desktop). Feed vertical READ-ONLY que compoe rotas ja
// existentes: pendencias (sessoes aguardando + tarefas do dia + pontas soltas do
// diario) -> em voo agora -> agenda de hoje -> diario resumido. Sessoes vem do
// contexto compartilhado (zero fetch novo de sessao); agenda/diario via useApi.
// Cada bloco degrada sozinho (lendo/vazio/erro). Tap numa sessao abre o dossie
// (onSelect); nota do dia / daily abrem no overlay (onOpenNote). Referencia de
// dados: Comando.jsx (desktop) — mesma semantica, layout de coluna.
import { useApi } from './api.js';
import { useSessions, projectColor, shortModel, isAwaiting } from './roomData.js';
import { actionPhrase, callsign } from './callsigns.js';
import MiniAvatar from './MiniAvatar.jsx';
import { fmtAgo } from './mobile-fila.jsx';
import './mobile-hoje.css';

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LIVE_MAX = 6;
const DIARY_MAX = 4;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayMeta(ativos) {
  const d = new Date();
  return `${WD[d.getDay()]}, ${d.getDate()} ${MES[d.getMonth()]} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    + ` · ${ativos} ativo${ativos === 1 ? '' : 's'}`;
}

// Identidade compacta de sessao: avatar + callsign; projeto vira sufixo dim so
// quando difere de 'home' (mesma regra do Comando desktop).
function SessionIdent({ session }) {
  const proj = session.project && session.project !== 'home' ? session.project : null;
  return (
    <>
      <MiniAvatar session={session} width={14} />
      <span className="mbh-strong">{callsign(session.id)}</span>
      {proj ? <span className="mbh-dim">{proj}</span> : null}
    </>
  );
}

function dotClass(s) {
  if (isAwaiting(s)) return 'wait';
  if (s.state === 'ativa') return 'work';
  if (s.state === 'ociosa') return 'idle';
  return 'sleep';
}

export default function MobileHoje({ now, onSelect, onOpenNote }) {
  const { sessions } = useSessions();
  const iso = todayISO();
  const agenda = useApi(`/api/agenda?from=${iso}&to=${iso}`);
  const diary = useApi('/api/diary');

  const day = agenda.data && Array.isArray(agenda.data.days) ? agenda.data.days[0] : null;
  const events = day && Array.isArray(day.events) ? day.events : [];
  const dailyTasks = day && Array.isArray(day.tasks) ? day.tasks.filter((t) => t && !t.done) : [];
  const dailyNote = day && day.exists && typeof day.path === 'string' ? day.path : null;

  const diaryEntries = Array.isArray(diary.data) ? diary.data : [];
  const looseEnds = diaryEntries
    .filter((e) => e && e.pendencia)
    .map((e) => ({ project: e.project, text: e.pendencia }));

  const live = Array.isArray(sessions) ? sessions : [];
  const needsYou = live.filter(isAwaiting);
  const ativos = live.filter((s) => s && s.state === 'ativa').length;
  const pendCount = needsYou.length + dailyTasks.length + looseEnds.length;

  return (
    <div className="mb-body mbh-feed">
      <header className="mbh-day">
        <span className="mbh-title">Comando do Dia</span>
        <span className="mbh-meta">{dayMeta(ativos)}</span>
      </header>

      <PendBlock needsYou={needsYou} tasks={dailyTasks} looseEnds={looseEnds}
        count={pendCount} now={now} loading={diary.loading || agenda.loading} onSelect={onSelect} />
      <LiveBlock live={live} onSelect={onSelect} />
      <AgendaBlock events={events} note={dailyNote} loading={agenda.loading}
        error={agenda.error} onOpenNote={onOpenNote} />
      <DiaryBlock entries={diaryEntries} live={live} loading={diary.loading}
        error={diary.error} onOpenNote={onOpenNote} />
    </div>
  );
}

function Block({ label, count, children }) {
  return (
    <section className="mbh-block">
      <h2 className="mbh-lbl">{label}{count > 0 ? <span className="mbh-n"> · {count}</span> : null}</h2>
      {children}
    </section>
  );
}

function PendBlock({ needsYou, tasks, looseEnds, count, now, loading, onSelect }) {
  const empty = !loading && count === 0;
  return (
    <Block label="pendências" count={count}>
      {loading && count === 0 ? <p className="mbh-state">lendo…</p> : null}
      {empty ? <p className="mbh-state">nada pendente — dia limpo</p> : null}
      {needsYou.map((s) => (
        <button key={s.id} type="button" className="mbh-row tap"
          style={{ '--mb-accent': projectColor(s.project) }}
          onClick={() => onSelect({ type: 'session', sessionId: s.id })}>
          <span className="mbh-dot wait" />
          <SessionIdent session={s} />
          <span className="mbh-dim mbh-push">há {fmtAgo(s, now)}</span>
        </button>
      ))}
      {tasks.map((t, i) => (
        <div key={'t' + i} className="mbh-row">
          <span className="mbh-chk">▢</span>
          <span>{t.text}</span>
        </div>
      ))}
      {looseEnds.map((l, i) => (
        <div key={'l' + i} className="mbh-row">
          <span className="mbh-flag">⚑</span>
          <span className="mbh-dim">{l.project ? l.project + ': ' : ''}{l.text}</span>
        </div>
      ))}
    </Block>
  );
}

function LiveBlock({ live, onSelect }) {
  const rows = live.slice(0, LIVE_MAX);
  return (
    <Block label="em voo agora" count={live.length}>
      {rows.length === 0 ? <p className="mbh-state">nenhum agente nas últimas 4h</p> : null}
      {rows.map((s) => (
        <button key={s.id} type="button" className="mbh-row tap"
          style={{ '--mb-accent': projectColor(s.project) }}
          onClick={() => onSelect({ type: 'session', sessionId: s.id })}>
          <span className={`mbh-dot ${dotClass(s)}`} />
          <SessionIdent session={s} />
          <span className="mbh-dim mbh-clip">{isAwaiting(s) ? 'esperando você' : (actionPhrase(s) || 'pensando…')}</span>
          <span className="mbh-model mbh-push">{shortModel(s.model)}</span>
        </button>
      ))}
    </Block>
  );
}

function AgendaBlock({ events, note, loading, error, onOpenNote }) {
  return (
    <Block label="hoje · agenda" count={0}>
      {loading ? <p className="mbh-state">lendo…</p> : null}
      {error && !loading ? <p className="mbh-state crit">agenda offline</p> : null}
      {!loading && !error && events.length === 0 ? <p className="mbh-state">sem eventos hoje</p> : null}
      {events.map((e, i) => (
        <div key={'e' + i} className="mbh-row">
          <span className="mbh-mono mbh-strong">{e.start || '--:--'}</span>
          <span>{e.title}</span>
        </div>
      ))}
      {note ? (
        <button type="button" className="mbh-link" onClick={() => onOpenNote && onOpenNote(note)}>
          ↗ nota do dia
        </button>
      ) : null}
    </Block>
  );
}

function DiaryBlock({ entries, live, loading, error, onOpenNote }) {
  const rows = entries.slice(0, DIARY_MAX);
  const liveById = new Map((live || []).map((s) => [s.id, s]));
  return (
    <Block label="diário · o que você fez" count={0}>
      {loading && rows.length === 0 ? <p className="mbh-state">lendo…</p> : null}
      {error && !loading ? <p className="mbh-state crit">diário offline</p> : null}
      {!loading && !error && rows.length === 0 ? <p className="mbh-state">nenhuma sessão recente</p> : null}
      {rows.map((e, i) => {
        const liveSes = e.isLive ? liveById.get(e.id) : null;
        const liveDoing = liveSes ? (liveSes.narrative || actionPhrase(liveSes)) : null;
        const hero = e.isLive
          ? (liveDoing || e.mission || e.pedido || 'sessão ao vivo')
          : (e.resumo || e.pedido || 'sessão sem resumo');
        return (
          <div key={e.id || 'd' + i} className="mbh-drow" style={{ '--mb-accent': projectColor(e.project) }}>
            <div className="mbh-drow-top">
              <SessionIdent session={{ id: e.id, project: e.project }} />
              {e.commits > 0 ? <span className="mbh-chip ship">✓ {e.commits}</span> : null}
              {e.dailyPath ? (
                <button type="button" className="mbh-chip link"
                  onClick={() => onOpenNote && onOpenNote(e.dailyPath)}>↗ daily</button>
              ) : null}
            </div>
            <span className={'mbh-hero' + (e.isLive ? ' mbh-dim' : '')}>{hero}</span>
          </div>
        );
      })}
    </Block>
  );
}
