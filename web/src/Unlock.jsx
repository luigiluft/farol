// FAROL - estado vazio ACIONAVEL (produto instalavel): quando uma view
// depende de convencao do vault, o vazio ensina a destravar em vez de so
// constatar. Theme-safe (currentColor/tokens, sem hardcode de cor).
// Uso: <Unlock title lead steps={[...]} example guia="#anchor" />
import { useState } from 'react';
import './unlock.css';

const GUIA_URL = 'https://github.com/luigiluft/farol/blob/main/docs/GUIA.md';

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 1600);
    } catch {
      // clipboard bloqueado (http remoto): sem feedback, exemplo segue visivel
    }
  };
  return (
    <button type="button" className="unlock-copy" onClick={copy}>
      {ok ? 'copiado ✓' : 'copiar'}
    </button>
  );
}

export default function Unlock({ title, lead, steps = [], example, exampleLabel, guia }) {
  return (
    <div className="unlock">
      <div className="unlock-badge">como destravar esta tela</div>
      <h3 className="unlock-title">{title}</h3>
      {lead ? <p className="unlock-lead">{lead}</p> : null}
      {steps.length > 0 ? (
        <ol className="unlock-steps">
          {steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      ) : null}
      {example ? (
        <div className="unlock-example">
          <div className="unlock-example-head">
            <span className="unlock-example-label">{exampleLabel || 'exemplo'}</span>
            <CopyBtn text={example} />
          </div>
          <pre>{example}</pre>
        </div>
      ) : null}
      <a
        className="unlock-guia"
        href={guia ? `${GUIA_URL}${guia}` : GUIA_URL}
        target="_blank"
        rel="noreferrer"
      >
        guia completo →
      </a>
    </div>
  );
}
