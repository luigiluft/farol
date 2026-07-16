// FAROL - view Diario (Frente 1): as 5 sessoes interativas mais recentes,
// cada uma com resumo em prosa + fatos mecanicos. Fetch unico via useApi
// (/api/diary) com refresh manual; estados loading/vazio/erro.
// Card AO VIVO faz join com a sessao viva (SSE): mostra o que o agente esta
// FAZENDO (narrative/acao), nao o prompt cru do usuario (auditoria 2026-07-02).
import { useApi } from './api.js';
import { useSessions } from './roomData.js';
import DiaryCard from './DiaryCard.jsx';
import './diary.css';

export default function Diary({ onOpenNote }) {
  const { data, error, loading, reload } = useApi('/api/diary');
  const { sessions } = useSessions();
  const liveById = new Map((sessions || []).map((s) => [s.id, s]));
  const entries = Array.isArray(data) ? data : [];

  return (
    <div className="diary">
      <header className="diary-head">
        <div className="diary-title">
          <h2>Diário</h2>
          <span className="diary-sub dim">últimas 5 sessões · o que você fez</span>
        </div>
        <button type="button" className="diary-refresh" onClick={reload} disabled={loading} title="Atualizar">
          {loading ? 'atualizando…' : 'atualizar'}
        </button>
      </header>

      {loading && entries.length === 0 ? <div className="diary-state dim">lendo o histórico…</div> : null}
      {error && !loading ? (
        <div className="diary-state crit">diário offline: {String((error && error.message) || error)}</div>
      ) : null}
      {!loading && !error && entries.length === 0 ? (
        <div className="diary-state dim">nenhuma sessão interativa recente</div>
      ) : null}

      <ol className="diary-list">
        {entries.map((e) => (
          <DiaryCard key={e.id} entry={e} liveSession={liveById.get(e.id) || null} onOpenNote={onOpenNote} />
        ))}
      </ol>
    </div>
  );
}
