// FAROL - regua de sistema (A3) + linha Claude Code (redesign UX).
// Linha 1 (maquina): CPU (barra scaleX), RAM usado/total, disco livre,
// uptime, agentes ativos e lampada de drift com tooltip.
// Linha 2 (Claude Code): contexto da sessao em foco (barra + %),
// tokens gerados na ultima hora e no dia. Dados: /api/stats + SSE
// {type:'stats',...} (campo usage novo, guard p/ payload antigo);
// contexto vem do pipeline compartilhado de sessoes (zero fetch extra).
// F3: o hook useStats e exportado para o telao diegetico da RoomScene.
import { useEffect, useState } from 'react';
import { fetchJson, useSSE } from './api.js';
import { useSessions, contextPct, fmtTokens, agentCounts } from './roomData.js';
import { callsign } from './callsigns.js';
import { StatusLamp } from './sprites.jsx';
import './room.css';

const DRIFT_LABEL = {
  ok: 'drift: tudo em ordem',
  warn: 'drift: atencao',
  crit: 'drift: critico',
  unknown: 'drift: desconhecido',
};

// O SSE espalha os campos no proprio evento ({type:'stats', cpuPct,...});
// aceita tambem {stats:{...}} ou {data:{...}} por seguranca.
function extractStats(ev) {
  if (ev.stats && typeof ev.stats === 'object') return ev.stats;
  if (ev.data && typeof ev.data === 'object') return ev.data;
  const { type, ...rest } = ev;
  return rest;
}

// Telemetria compartilhada: StatsBar (regua) e RoomScene (telao).
export function useStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchJson('/api/stats')
      .then((data) => { if (alive) setStats(data); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  useSSE((ev) => {
    if (!ev || ev.type !== 'stats') return;
    setStats(extractStats(ev));
    setError(null);
  });

  return { stats, error };
}

function fmtUptime(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function gb(mb) {
  return (Number(mb || 0) / 1024).toFixed(1);
}

function Stat({ label, value, title }) {
  return (
    <span className="stat" title={title}>
      <span className="stat-key">{label}</span>
      <span className="stat-val">{value}</span>
    </span>
  );
}

// ------------------------------------------------------------------
// linha Claude Code: contexto em foco + uso por janela de tempo
// ------------------------------------------------------------------

// Sessao "em foco": a interativa mais quente (o pipeline ja ordena por
// estado e atividade); tarefas one-shot nao representam o contexto vivo.
function foregroundSession(sessions) {
  if (!Array.isArray(sessions)) return null;
  return sessions.find((s) => s && s.kind !== 'tarefa') || null;
}

function usageHint(prefix, u) {
  if (!u) return `${prefix}: sem dados ainda`;
  const parts = [
    `gerados ${fmtTokens(u.out)}`,
    `entrada ${fmtTokens(u.in)}`,
    `cache ${fmtTokens(u.cacheRead + u.cacheCreate)}`,
  ];
  return `${prefix}: ${parts.join(' · ')}`;
}

function ContextStat({ session }) {
  const pct = contextPct(session);
  if (!session || pct === null) {
    return <Stat label="contexto" value="--" title="sem sessao interativa com dados de contexto" />;
  }
  const level = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
  const hint = `contexto de ${callsign(session.id)} (${session.project || 'sessao'}): `
    + `${fmtTokens(session.contextTokens)} tokens em uso = ${pct}% da janela do modelo`;
  return (
    <span className="stat" title={hint}>
      <span className="stat-key">contexto</span>
      <span className="cpu-bar">
        <span className={`cpu-fill cpu-${level}`} style={{ transform: `scaleX(${pct / 100})` }} />
      </span>
      <span className="stat-val">{pct}%</span>
    </span>
  );
}

function ClaudeRow({ stats }) {
  const { sessions } = useSessions();
  const fg = foregroundSession(sessions);
  const usage = stats && stats.usage ? stats.usage : null;
  const hour = usage ? usage.hour : null;
  const today = usage ? usage.today : null;
  return (
    <div className="stats-row stats-row-cc">
      <span className="stat stat-cc-label" title="telemetria das sessoes Claude Code desta maquina">
        <span className="stat-key">claude code</span>
      </span>
      <ContextStat session={fg} />
      <Stat
        label="1h"
        value={hour ? fmtTokens(hour.out) : '--'}
        title={usageHint('tokens gerados na ultima hora', hour)}
      />
      <Stat
        label="hoje"
        value={today ? fmtTokens(today.out) : '--'}
        title={usageHint('tokens gerados hoje (desde 00:00)', today)}
      />
    </div>
  );
}

export default function StatsBar() {
  const { stats, error } = useStats();
  const { sessions } = useSessions();

  if (!stats) {
    return (
      <div className="panel statsbar statsbar-wait" role="status">
        {error ? 'telemetria offline' : 'lendo telemetria...'}
      </div>
    );
  }

  const cpu = Math.max(0, Math.min(100, Number(stats.cpuPct) || 0));
  const cpuLevel = cpu >= 90 ? 'crit' : cpu >= 70 ? 'warn' : 'ok';
  const drift = DRIFT_LABEL[stats.drift] ? stats.drift : 'unknown';
  // F8: contagem coerente com os paineis (antes era stats.sessionsActive,
  // mtime<3min, que misturava quem ja encerrou o turno com quem trabalha).
  const { working, waiting, total } = agentCounts(sessions);

  return (
    <div className="panel statsbar" role="status" aria-label="Telemetria do sistema">
      <div className="stats-row">
        <span className="stat" title="uso de CPU">
          <span className="stat-key">cpu</span>
          <span className="cpu-bar">
            <span className={`cpu-fill cpu-${cpuLevel}`} style={{ transform: `scaleX(${cpu / 100})` }} />
          </span>
          <span className="stat-val">{Math.round(cpu)}%</span>
        </span>
        <Stat label="ram" value={`${gb(stats.memUsedMb)}/${gb(stats.memTotalMb)}G`} title="memoria usada / total" />
        <Stat label="hd" value={stats.diskFreeGb == null ? 'n/d' : `${Math.round(stats.diskFreeGb)}G`} title="espaco livre em disco" />
        <Stat label="up" value={fmtUptime(stats.uptimeMin)} title="uptime da maquina" />
        <Stat
          label="agentes"
          value={waiting > 0 ? `${working}+${waiting}` : working}
          title={`${working} trabalhando · ${waiting} esperando · ${total} sessoes (ultimas 4h)`}
        />
        <span className="stat stat-drift" tabIndex={0} aria-label={DRIFT_LABEL[drift]}>
          <StatusLamp status={drift} className="drift-lamp" />
          <span className="tt-mini" role="tooltip">{DRIFT_LABEL[drift]}</span>
        </span>
      </div>
      <ClaudeRow stats={stats} />
    </div>
  );
}
