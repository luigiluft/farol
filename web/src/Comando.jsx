// FAROL - Comando do Dia (Frente 4, v1 desktop · layout Bento aprovado por
// mockup). Home-cockpit READ-ONLY que compoe endpoints ja existentes: agenda
// de hoje + sessoes vivas + diario + stats. Sem fetch novo de sessoes (usa o
// contexto compartilhado por SSE). Cada tile degrada sozinho (loading/vazio/
// erro) — nunca quebra o first paint (e a view default). Interacoes v1: "ver
// diario completo" e "ver frota" trocam de aba; nota do dia abre no NoteView.
import { useApi } from './api.js';
import { useSessions, projectColor, fmtTokens, shortModel, isAwaiting } from './roomData.js';
import { actionPhrase, callsign } from './callsigns.js';
import MiniAvatar from './MiniAvatar.jsx';
import './comando.css';

const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const LIVE_MAX = 5;
const DIARY_MAX = 3;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// (f) tempo de espera de uma sessao awaiting, desde a ultima atividade.
function waitFor(s) {
  const ts = Date.parse((s && s.lastActivityTs) || '');
  if (!Number.isFinite(ts)) return '';
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + 'min';
  return 'há ' + Math.floor(min / 60) + 'h' + pad2(min % 60);
}

// (d) contexto da sessao viva: fracao da janela (avisa antes do compact).
function ctxPct(s) {
  const used = Number(s && s.contextTokens);
  const limit = Number(s && s.contextLimit) || 200000;
  if (!Number.isFinite(used) || used <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
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

// Gate obrigatorio do payload: sessao ENCERRADA chega com awaiting=true —
// sem o check de estado ela viraria pendencia fantasma (gotcha 2026-07-02).
function isWaiting(s) {
  return isAwaiting(s) && s && s.state !== 'dormindo';
}

// Estado da sessao -> classe do dot (mesma semantica de cor do app:
// verde=trabalhando, rosa=esperando voce, ambar=ocioso, dim=dormindo).
function dotClass(s) {
  if (isWaiting(s)) return 'wait';
  if (s.state === 'ativa') return 'work';
  if (s.state === 'ociosa') return 'idle';
  return 'sleep';
}

// Identidade de sessao nas listas: avatar + CALLSIGN (padrao do painel de
// operacoes); projeto vira sufixo dim so quando difere de 'home' — repetir
// 'home' em toda linha era ruido sem informacao (auditoria 2026-07-02).
function SessionIdent({ session }) {
  if (!session || !session.id) {
    return <span className="cmd-strong">{(session && session.project) || 'sessão'}</span>;
  }
  const proj = session.project && session.project !== 'home' ? session.project : null;
  return (
    <>
      <MiniAvatar session={session} width={14} />
      <span className="cmd-strong">{callsign(session.id)}</span>
      {proj ? <span className="cmd-dim">{proj}</span> : null}
    </>
  );
}

export default function Comando({ onOpenNote, onGoView }) {
  const { sessions } = useSessions();
  const iso = todayISO();
  const agenda = useApi(`/api/agenda?from=${iso}&to=${iso}`);
  const diary = useApi('/api/diary');
  const stats = useApi('/api/stats');
  // fonte CANONICA de tokens (rollup completo); os buckets do /api/stats so
  // veem a janela viva e descolavam do USO (741k vs 1.8M, feedback 03/07)
  const usage = useApi('/api/usage?days=8');
  const vaultPend = useApi('/api/pendencias');
  const esteira = useApi('/api/esteira');

  const day = agenda.data && Array.isArray(agenda.data.days) ? agenda.data.days[0] : null;
  const events = day && Array.isArray(day.events) ? day.events : [];
  const dailyTasks = day && Array.isArray(day.tasks) ? day.tasks.filter((t) => t && !t.done) : [];
  const dailyNote = day && day.exists && typeof day.path === 'string' ? day.path : null;

  const diaryEntries = Array.isArray(diary.data) ? diary.data : [];
  const looseEnds = diaryEntries
    .filter((e) => e && e.pendencia)
    .map((e) => ({ project: e.project, text: e.pendencia }));

  const live = Array.isArray(sessions) ? sessions : [];
  const needsYou = live.filter(isWaiting);
  const ativos = live.filter((s) => s && s.state === 'ativa').length;
  const pendCount = needsYou.length + dailyTasks.length + looseEnds.length;

  return (
    <div className="comando">
      <header className="cmd-day">
        <span className="cmd-title">Comando do Dia</span>
        <span className="cmd-meta">{dayMeta(ativos)}</span>
      </header>

      <div className="cmd-bento">
        <PendTile
          needsYou={needsYou}
          dailyTasks={dailyTasks}
          looseEnds={looseEnds}
          count={pendCount}
          loading={diary.loading || agenda.loading}
          onGoView={onGoView}
        />
        <AgendaTile events={events} note={dailyNote} loading={agenda.loading} error={agenda.error}
          onOpenNote={onOpenNote} onGoView={onGoView} />
        <LiveTile live={live} onGoView={onGoView} />
        <VaultPendTile data={vaultPend.data} loading={vaultPend.loading} onOpenNote={onOpenNote} />
        <MachineTile stats={stats.data} />
        <SpendTile usage={usage.data} onGoView={onGoView} />
        <InboxTile data={vaultPend.data} onOpenNote={onOpenNote} />
        <TopicTile usage={usage.data} onGoView={onGoView} />
        <EsteiraTile data={esteira.data} onGoView={onGoView} />
        <DiaryTile entries={diaryEntries} liveSessions={live} loading={diary.loading} error={diary.error}
          onGoView={onGoView} onOpenNote={onOpenNote} />
      </div>
    </div>
  );
}

function PendTile({ needsYou, dailyTasks, looseEnds, count, loading, onGoView }) {
  const empty = !loading && count === 0;
  return (
    <section className="cmd-card cmd-pend">
      <div className="cmd-lbl">⚑ pendências {count > 0 ? <span className="cmd-n">· {count}</span> : null}</div>
      {loading && count === 0 ? <p className="cmd-dim cmd-state">lendo…</p> : null}
      {empty ? <p className="cmd-dim cmd-state">nada pendente — dia limpo</p> : null}
      {needsYou.map((s) => (
        <button
          key={s.id}
          type="button"
          className="cmd-qrow"
          title="abrir no cockpit"
          onClick={() => onGoView && onGoView('cockpit')}
        >
          <span className="cmd-dot wait" />
          <SessionIdent session={s} />
          <span className="cmd-wait-t">{waitFor(s)}</span>
          {s.pendingQuestion
            ? <span className="cmd-q">{'“'}{s.pendingQuestion}{'”'}</span>
            : <span className="cmd-dim">aguardando seu input</span>}
        </button>
      ))}
      {dailyTasks.map((t, i) => (
        <div key={'t' + i} className="cmd-row">
          <span className="cmd-chk">▢</span>
          <span>{t.text}</span>
        </div>
      ))}
      {looseEnds.map((l, i) => (
        <div key={'l' + i} className="cmd-row">
          <span className="cmd-flag">⚑</span>
          <span className="cmd-dim">{l.project ? l.project + ': ' : ''}{l.text}</span>
        </div>
      ))}
    </section>
  );
}

function AgendaTile({ events, note, loading, error, onOpenNote, onGoView }) {
  return (
    <section className="cmd-card cmd-agenda">
      <div className="cmd-lbl">hoje · agenda</div>
      {loading ? <p className="cmd-dim cmd-state">lendo…</p> : null}
      {error && !loading ? <p className="cmd-crit cmd-state">agenda offline</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p className="cmd-dim cmd-state">sem eventos hoje</p>
      ) : null}
      {events.map((e, i) => (
        <div key={'e' + i} className="cmd-row">
          <span className="cmd-mono cmd-strong">{e.start || '--:--'}</span>
          <span>{e.title}</span>
        </div>
      ))}
      {note ? (
        <button type="button" className="cmd-link" onClick={() => onOpenNote && onOpenNote(note)}>
          ↗ nota do dia
        </button>
      ) : null}
    </section>
  );
}

function LiveTile({ live, onGoView }) {
  const rows = live.slice(0, LIVE_MAX);
  return (
    <section className="cmd-card cmd-live">
      <div className="cmd-lbl">em voo agora {live.length > 0 ? <span className="cmd-n">· {live.length}</span> : null}</div>
      {rows.length === 0 ? <p className="cmd-dim cmd-state">nenhum agente nas últimas 4h</p> : null}
      {rows.map((s) => {
        const pct = ctxPct(s);
        return (
          <div key={s.id} className="cmd-row">
            <span className={`cmd-dot ${dotClass(s)}`} />
            <SessionIdent session={s} />
            <span className="cmd-dim cmd-clip">{isWaiting(s) ? 'esperando ' + waitFor(s) : (actionPhrase(s) || 'pensando…')}</span>
            {pct !== null && (
              <span className={'cmd-ctx' + (pct >= 70 ? ' hot' : '')} title={'contexto: ' + pct + '% da janela'}>
                <span className="cmd-ctx-trk"><span className="cmd-ctx-fill" style={{ width: pct + '%' }} /></span>
                {pct}%
              </span>
            )}
            <span className="cmd-when">{shortModel(s.model)}</span>
          </div>
        );
      })}
      {live.length > 0 ? (
        <button type="button" className="cmd-link" onClick={() => onGoView && onGoView('torre')}>
          ver frota →
        </button>
      ) : null}
    </section>
  );
}

function MachineTile({ stats }) {
  const cpu = stats && Number.isFinite(stats.cpuPct) ? Math.round(stats.cpuPct) : null;
  const ramU = stats && Number.isFinite(stats.memUsedMb) ? (stats.memUsedMb / 1024).toFixed(1) : null;
  const ramT = stats && Number.isFinite(stats.memTotalMb) ? Math.round(stats.memTotalMb / 1024) : null;
  const drift = stats && stats.drift;
  const driftLabel = !drift || drift === 'ok' ? 'drift ok' : 'drift ⚠';
  return (
    <section className="cmd-card cmd-kpi">
      <div className="cmd-lbl">máquina</div>
      <div className="cmd-kpi-v">{cpu === null ? '--' : cpu + '%'}
        <small>{ramU !== null && ramT !== null ? `cpu · ram ${ramU}/${ramT}gb · ${driftLabel}` : 'cpu'}</small>
      </div>
    </section>
  );
}

// Gasto = rollup canonico do /api/usage (in+out do dia; os buckets do stats
// descolavam por so verem a janela viva). Small = media dos 7d anteriores.
function SpendTile({ usage, onGoView }) {
  const days = usage && Array.isArray(usage.days) ? usage.days : null;
  let hoje = null;
  let media = null;
  if (days && days.length) {
    const d = new Date();
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const today = days.find((x) => x.date === iso);
    hoje = today ? today.total : 0;
    const prev = days.filter((x) => x.date !== iso);
    if (prev.length) media = Math.round(prev.reduce((a, x) => a + x.total, 0) / prev.length);
  }
  return (
    <section className="cmd-card cmd-kpi">
      <div className="cmd-lbl">gasto hoje</div>
      <div className="cmd-kpi-v">{hoje === null ? '--' : fmtTokens(hoje)}
        <small>
          tokens in+out{media !== null ? ` · média 7d ${fmtTokens(media)}` : ''}
        </small>
      </div>
      <button type="button" className="cmd-link" onClick={() => onGoView && onGoView('uso')}>
        ver uso →
      </button>
    </section>
  );
}

// (a) pendencias do VAULT (_Pendencias top 3, mesmo ranking do brief).
function VaultPendTile({ data, loading, onOpenNote }) {
  const top = data && Array.isArray(data.top) ? data.top : [];
  const total = data ? data.total : 0;
  return (
    <section className="cmd-card cmd-vpend">
      <div className="cmd-lbl">vault · pendências {total > 0 ? <span className="cmd-n">· {total}</span> : null}</div>
      {loading && !data ? <p className="cmd-dim cmd-state">lendo…</p> : null}
      {data && top.length === 0 ? (
        <p className="cmd-dim cmd-state">
          nenhuma pendência aberta — crie notas em 1-Projects/_Pendencias/ com status 🔴🟡⚪ no frontmatter
        </p>
      ) : null}
      {top.map((p) => (
        <button
          key={p.id}
          type="button"
          className="cmd-qrow"
          title={p.projeto || p.id}
          onClick={() => onOpenNote && onOpenNote(p.path)}
        >
          <span className="cmd-vp-st">{p.status}</span>
          <span className="cmd-vp-t">{p.title}</span>
          {p.tempo ? <span className="cmd-when">{p.tempo}</span> : null}
        </button>
      ))}
    </section>
  );
}

// (c) inbox: contagem + atalho pro item mais novo.
function InboxTile({ data, onOpenNote }) {
  const count = data && data.inbox ? data.inbox.count : null;
  const newest = data && data.inbox ? data.inbox.newest : null;
  return (
    <section className="cmd-card cmd-kpi">
      <div className="cmd-lbl">inbox</div>
      <div className="cmd-kpi-v">{count === null ? '--' : count}
        <small>itens no 0-Inbox</small>
      </div>
      {newest ? (
        <button type="button" className="cmd-link" onClick={() => onOpenNote && onOpenNote(newest)}>
          abrir mais recente →
        </button>
      ) : null}
    </section>
  );
}

// (e) top topico do dia (byTopic do rollup canonico).
function TopicTile({ usage, onGoView }) {
  let top = null;
  let pct = null;
  const days = usage && Array.isArray(usage.days) ? usage.days : null;
  if (days) {
    const d = new Date();
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const today = days.find((x) => x.date === iso);
    if (today && today.byTopic && today.total > 0) {
      const entries = Object.entries(today.byTopic).sort((a, b) => b[1] - a[1]);
      if (entries.length) {
        top = entries[0][0];
        pct = Math.round((entries[0][1] / today.total) * 100);
      }
    }
  }
  return (
    <section className="cmd-card cmd-kpi">
      <div className="cmd-lbl">tópico do dia</div>
      <div className="cmd-kpi-v">{top || '--'}
        <small>{pct !== null ? pct + '% dos tokens de hoje' : 'sem gasto ainda'}</small>
      </div>
      <button type="button" className="cmd-link" onClick={() => onGoView && onGoView('uso')}>
        aonde vai o token →
      </button>
    </section>
  );
}

// (b) esteira: ultima falha + proxima rotina agendada (faixa horizontal).
function EsteiraTile({ data, onGoView }) {
  const jobs = data && Array.isArray(data.jobs) ? data.jobs : [];
  const feed = data && Array.isArray(data.feed) ? data.feed : [];
  const lastFail = feed.find((f) => f.fail);
  const upcoming = jobs
    .filter((j) => j.enabled && Number.isFinite(j.nextMs) && j.nextMs > Date.now())
    .sort((a, b) => a.nextMs - b.nextMs)[0] || null;
  const nextIn = upcoming
    ? Math.max(1, Math.round((upcoming.nextMs - Date.now()) / 60000))
    : null;
  return (
    <section className="cmd-card cmd-esteira">
      <div className="cmd-lbl">esteira</div>
      <div className="cmd-est-row">
        {lastFail ? (
          <span className="cmd-est-item cmd-crit">
            ✕ {lastFail.name} falhou às {lastFail.t}
          </span>
        ) : (
          <span className="cmd-est-item cmd-ok">✓ nenhuma rotina falhou recente</span>
        )}
        <span className="cmd-est-sep">·</span>
        {upcoming ? (
          <span className="cmd-est-item">
            próxima: <span className="cmd-strong">{upcoming.name}</span>
            <span className="cmd-dim">{' em ' + (nextIn < 60 ? nextIn + 'min' : Math.floor(nextIn / 60) + 'h' + pad2(nextIn % 60))}</span>
          </span>
        ) : (
          <span className="cmd-est-item cmd-dim">nada agendado à vista</span>
        )}
        <button type="button" className="cmd-link cmd-est-link" onClick={() => onGoView && onGoView('esteira')}>
          ver esteira →
        </button>
      </div>
    </section>
  );
}

function DiaryTile({ entries, liveSessions, loading, error, onGoView, onOpenNote }) {
  const rows = entries.slice(0, DIARY_MAX);
  // Entrada AO VIVO mostra o que o agente esta FAZENDO (narrative/acao da
  // sessao viva), nao o prompt cru do usuario (auditoria 2026-07-02).
  const liveById = new Map((liveSessions || []).map((s) => [s.id, s]));
  return (
    <section className="cmd-card cmd-diary">
      <div className="cmd-lbl">diário · o que você fez</div>
      {loading && rows.length === 0 ? <p className="cmd-dim cmd-state">lendo…</p> : null}
      {error && !loading ? <p className="cmd-crit cmd-state">diário offline</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="cmd-dim cmd-state">nenhuma sessão recente</p>
      ) : null}
      {rows.map((e, i) => {
        const liveSes = e.isLive ? liveById.get(e.id) : null;
        const liveDoing = liveSes ? (liveSes.narrative || actionPhrase(liveSes)) : null;
        const hero = e.isLive
          ? (liveDoing || e.mission || e.pedido || 'sessão ao vivo')
          : (e.resumo || e.pedido || 'sessão sem resumo');
        return (
          <div key={e.id || 'd' + i} className="cmd-drow" style={{ '--cmd-c': projectColor(e.project) }}>
            <SessionIdent session={{ id: e.id, project: e.project }} />
            <span className={e.isLive ? 'cmd-dim' : ''}>{hero}</span>
            <span className="cmd-dchips">
              {e.commits > 0 ? <span className="cmd-chip ship">✓ {e.commits}</span> : null}
              {e.dailyPath ? (
                <button type="button" className="cmd-chip link"
                  onClick={() => onOpenNote && onOpenNote(e.dailyPath)}>↗ daily</button>
              ) : null}
            </span>
          </div>
        );
      })}
      {!error ? (
        <button type="button" className="cmd-link" onClick={() => onGoView && onGoView('diario')}>
          ver diário completo →
        </button>
      ) : null}
    </section>
  );
}
