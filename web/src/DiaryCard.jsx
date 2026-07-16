// FAROL - cartao do Diario: prosa-heroi + tira de chips + expand inline.
// Spine colorida por projeto (projectColor, nao theme-ada por contrato).
// Cartao vivo (isLive): dot pulsando + estado ao vivo, sem prosa congelada.
// Heroi do cartao vivo = o que o agente esta FAZENDO (narrative da sessao
// viva via prop liveSession, com fallback pra acao corrente) — o prompt cru
// do usuario so entra como ultimo recurso (auditoria 2026-07-02).
import { useState } from 'react';
import { projectColor, fmtTokens, shortModel } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < MIN_MS) return '<1min';
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.round((ms % HOUR_MS) / MIN_MS);
  if (h > 0) return `${h}h${m > 0 ? ' ' + m + 'min' : ''}`;
  return `${m}min`;
}

function fmtWhen(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const today = new Date();
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
    return `hoje ${hh}:${mm}`;
  }
  return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hh}:${mm}`;
}

function mechanicalLine(entry) {
  const bits = [];
  if (entry.fileCount > 0) bits.push(`${entry.fileCount} arquivo${entry.fileCount === 1 ? '' : 's'}`);
  if (entry.commits > 0) bits.push(`${entry.commits} commit${entry.commits === 1 ? '' : 's'}`);
  const tail = bits.length ? ' · ' + bits.join(' · ') : '';
  return (entry.pedido || 'sessão sem resumo') + tail;
}

function DailyChip({ path, onOpenNote }) {
  const open = (ev) => {
    ev.stopPropagation();
    if (onOpenNote) onOpenNote(path);
  };
  return (
    <button type="button" className="dc-chip dc-chip-link" onClick={open} title={path}>
      ↗ daily
    </button>
  );
}

function DiaryExpand({ entry }) {
  return (
    <div className="dc-expand">
      {entry.pendencia ? (
        <div className="dc-sec dc-sec-pend">
          <span className="dc-sec-label">⚑ pendência</span>
          <p>{entry.pendencia}</p>
        </div>
      ) : null}
      <div className="dc-sec">
        <span className="dc-sec-label">pedido</span>
        <p>{entry.pedido || '—'}</p>
      </div>
      {Array.isArray(entry.files) && entry.files.length ? (
        <div className="dc-sec">
          <span className="dc-sec-label">arquivos ({entry.fileCount})</span>
          <ul className="dc-files">
            {entry.files.map((f, i) => <li key={f + '#' + i} className="mono">{f}</li>)}
          </ul>
        </div>
      ) : null}
      {entry.narrative ? (
        <div className="dc-sec">
          <span className="dc-sec-label">saída</span>
          <p>{entry.narrative}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function DiaryCard({ entry, liveSession = null, onOpenNote }) {
  const [open, setOpen] = useState(false);
  const color = projectColor(entry.project);
  const live = Boolean(entry.isLive);
  const liveDoing = live && liveSession
    ? (liveSession.narrative || actionPhrase(liveSession))
    : null;
  const hero = live
    ? (liveDoing || entry.mission || entry.pedido || 'sessão ao vivo agora')
    : (entry.resumo || mechanicalLine(entry));

  return (
    <li className={`dc${live ? ' dc-live' : ''}`} style={{ '--dc-accent': color }}>
      <button type="button" className="dc-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="dc-top">
          {live ? <span className="dc-livedot" aria-hidden="true" /> : null}
          <span className="dc-proj">{entry.project || 'sessão'}</span>
          <span className="dc-call">{callsign(entry.id)}</span>
          <span className="dc-when dim">
            {live ? 'ao vivo' : `${fmtWhen(entry.startedTs)} · ${fmtDuration(entry.durationMs)}`}
          </span>
        </span>
        <span className={`dc-hero${live ? ' dc-hero-live' : ''}`}>{hero}</span>
      </button>
      <div className="dc-chips">
        {entry.fileCount > 0 ? <span className="dc-chip">{entry.fileCount} arquivo{entry.fileCount === 1 ? '' : 's'}</span> : null}
        {entry.commits > 0 ? <span className="dc-chip dc-chip-ship">✓ {entry.commits} commit{entry.commits === 1 ? '' : 's'}</span> : null}
        {entry.tokensOut ? <span className="dc-chip">{fmtTokens(entry.tokensOut)} tok</span> : null}
        {entry.model ? <span className="dc-chip">{shortModel(entry.model)}</span> : null}
        {!live && entry.pendencia ? <span className="dc-chip dc-chip-pend">⚑ pendência</span> : null}
        {entry.dailyPath ? <DailyChip path={entry.dailyPath} onOpenNote={onOpenNote} /> : null}
      </div>
      {open ? <DiaryExpand entry={entry} /> : null}
    </li>
  );
}
