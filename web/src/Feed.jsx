// FAROL - feed de atividade (A3, F3; origem dos dados trocada na F4).
// F7: linha vira "[hh:mm] Vega · projeto > lendo NoteView.jsx" — callsign
// da sessao + frase amigavel de callsigns.js (actionPhrase cobre toda tool:
// generico 'rodando <tool>' p/ nao mapeada; null so sem tool — o guard
// abaixo segue valendo; payload v2 nao quebra).
// Buffer construido no cliente: diff da frase por sessao a cada atualizacao
// do contexto compartilhado de sessoes (F4: useSessions via SessionsProvider
// do api.js; zero fetch/SSE proprios deste arquivo). Primeira leva de
// sessoes = seed (sem flash); as demais ganham flash sutil de opacity.
import { useEffect, useRef, useState } from 'react';
import { useSessions, projectColor } from './roomData.js';
import { callsign, actionPhrase } from './callsigns.js';
import { ToolIcon } from './Dossier.jsx';
import './room.css';

const MAX_ENTRIES = 20;

function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function Feed() {
  const { sessions } = useSessions();
  const [entries, setEntries] = useState([]);
  const lastLabelRef = useRef(new Map());
  const seqRef = useRef(0);
  const seededRef = useRef(false);
  const listRef = useRef(null);

  function ingest(list, isSeed) {
    if (!Array.isArray(list)) return;
    const fresh = [];
    for (const s of list) {
      if (!s || !s.id) continue;
      const label = actionPhrase(s);
      if (!label) continue;
      if (lastLabelRef.current.get(s.id) === label) continue;
      lastLabelRef.current.set(s.id, label);
      seqRef.current += 1;
      fresh.push({
        key: seqRef.current,
        ts: s.lastActivityTs || Date.now(),
        name: callsign(s.id),
        project: s.project || 'sessao',
        tool: (s.currentAction && s.currentAction.tool) || s.lastTool || null,
        label,
        isNew: !isSeed,
      });
    }
    if (!fresh.length) return;
    fresh.sort((a, b) => new Date(a.ts) - new Date(b.ts)); // ts pode ser ISO string
    setEntries((prev) => [...prev, ...fresh].slice(-MAX_ENTRIES));
  }

  useEffect(() => {
    if (!Array.isArray(sessions)) return;
    const isSeed = !seededRef.current;
    seededRef.current = true;
    ingest(sessions, isSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="panel feed" aria-label="Feed de atividade">
      <header className="feed-header" title="ultima acao de cada agente, em tempo real">
        atividade
      </header>
      <ol className="feed-list" ref={listRef}>
        {entries.map((e) => (
          <li
            key={e.key}
            className={`feed-item${e.isNew ? ' feed-item-new' : ''}`}
            title={`${e.name} (${e.project}): ${e.label}`}
          >
            <span className="feed-time">{fmtTime(e.ts)}</span>
            <ToolIcon tool={e.tool} className="feed-icon" />
            <span className="feed-name">{e.name}</span>
            <span className="feed-proj" style={{ '--proj-color': projectColor(e.project) }}>
              {e.project}
            </span>
            <span className="feed-label">{e.label}</span>
          </li>
        ))}
      </ol>
      {entries.length === 0 ? <div className="feed-empty">sem atividade ainda</div> : null}
    </div>
  );
}
