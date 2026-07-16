// FAROL - Cockpit v2: pane DIFF ("o que a sessao mudou"). Le GET /api/diff
// (Task 1.1): status porcelain + diff HEAD colorido (+/-), com refresh
// periodico e refresh manual. Theme-safe (.panel + currentColor), ao
// contrario do OLHO que e sempre escuro (sala de controle).
import { useEffect, useState, useCallback } from 'react';
import { fetchJson } from './api.js';

const AUTO_MS = 20000;

function lineClass(l) {
  if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ')) return 'ck-diff-meta';
  if (l.startsWith('@@')) return 'ck-diff-hunk';
  if (l.startsWith('+')) return 'ck-diff-add';
  if (l.startsWith('-')) return 'ck-diff-del';
  return '';
}

// Mensagem por motivo de ok:false (ver server/diff.mjs): sem-cwd = sessao sem
// cwd de projeto detectavel; sem-git = cwd existe mas nao e repo; diff-grande
// = projeto/git existem, so que `git status --porcelain` estourou o maxBuffer
// (arquivos demais pra enumerar) — 3 causas reais, 3 mensagens.
function reasonMsg(reason) {
  if (reason === 'sem-git') return 'projeto sem git';
  if (reason === 'diff-grande') return 'mudanças grandes demais pra enumerar';
  return 'sessão sem diretório de projeto detectável';
}

export default function DiffPane({ session }) {
  const id = session?.id;
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Kernel de fetch compartilhado pelos 2 effects abaixo. Cada effect injeta
  // seu proprio `isAlive` fechado sobre um `alive` local — mesma idioma do
  // api.js useBriefing (let alive = true; ... if (!alive) return; ... cleanup
  // alive = false) — so que aqui o alive mora no effect chamador (load
  // imediato x interval), nao dentro do fetch, porque o fetch e um so.
  const fetchDiff = useCallback(async (isAlive) => {
    if (!id) return;
    setBusy(true);
    try {
      const json = await fetchJson(`/api/diff?id=${encodeURIComponent(id)}`);
      if (!isAlive()) return;
      setData(json);
      setErr(null);
    } catch (e) {
      if (!isAlive()) return;
      setErr(String(e.message || e));
    } finally {
      if (isAlive()) setBusy(false);
    }
  }, [id]);

  // Effect 1: reset (data + err) + load imediato na troca de sessao/mount.
  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    fetchDiff(() => alive);
    return () => { alive = false; };
  }, [fetchDiff]);

  // Effect 2: refresh periodico, alive proprio — resposta que chega depois do
  // cleanup (troca de sessao ou unmount) nunca escreve state stale.
  useEffect(() => {
    let alive = true;
    const t = setInterval(() => fetchDiff(() => alive), AUTO_MS);
    return () => { alive = false; clearInterval(t); };
  }, [fetchDiff]);

  if (!id) return <div className="ck-diff panel"><div className="ck-diff-empty">sem sessão em foco</div></div>;
  return (
    <div className="ck-diff panel">
      <div className="ck-diff-head">
        <span className="ck-diff-title">MUDANÇAS</span>
        {data?.ok && <span className="ck-diff-branch">{data.branch}</span>}
        {data?.ok && <span className="ck-diff-count">{data.files.length} arquivo{data.files.length === 1 ? '' : 's'}</span>}
        <button className="ck-diff-refresh" onClick={() => fetchDiff(() => true)} disabled={busy} title="atualizar">↻</button>
      </div>
      {err && <div className="ck-diff-empty">erro: {err}</div>}
      {data && !data.ok && (
        <div className="ck-diff-empty">{reasonMsg(data.reason)}</div>
      )}
      {data?.ok && data.files.length === 0 && <div className="ck-diff-empty">árvore limpa — nada mudou</div>}
      {data?.ok && data.files.length > 0 && (
        <>
          <div className="ck-diff-files">
            {data.files.map((f) => (
              <span key={f.path} className="ck-diff-file" data-st={f.status}>
                <b>{f.status}</b> {f.path}
              </span>
            ))}
          </div>
          {data.tooLarge ? (
            <div className="ck-diff-empty">diff grande demais pra exibir</div>
          ) : (
            <pre className="ck-diff-body">
              {data.diff.split('\n').map((l, i) => (
                <span key={i} className={lineClass(l)}>{l}{'\n'}</span>
              ))}
              {data.truncated && <span className="ck-diff-meta">… (truncado em 512KB)</span>}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
