// FAROL - Preferências (Frente 2 · Personalização). Popover read-write que
// deixa o operador personalizar VENDO ao vivo: acento (--accent inline, DOM-
// only) + densidade (data-density). theme.js e a fonte unica e persiste tudo.
// Sem extra-themes nesta fatia (custo de paleta de canvas por tema fica para
// depois). Mudancas aplicam na hora via CSS — sem re-render do app.
import { useState } from 'react';
import { getAccent, setAccent, getDensity, setDensity } from './theme.js';
import { getNotifyPref, setNotifyPref } from './notify.js';
import './settings.css';

// Swatches curados a partir da paleta da casa; "padrão" limpa o override e
// volta ao --accent do tema. O operador escolhe vendo (design-by-seeing).
const SWATCHES = [
  { hex: null, label: 'padrão' },
  { hex: '#3ddc84', label: 'verde' },
  { hex: '#4dd0e1', label: 'ciano' },
  { hex: '#5ea2ff', label: 'azul' },
  { hex: '#b48cfa', label: 'violeta' },
  { hex: '#ff6ea8', label: 'rosa' },
  { hex: '#ffb454', label: 'âmbar' },
];

export default function Settings({ onClose }) {
  const [accent, setLocalAccent] = useState(getAccent);
  const [density, setLocalDensity] = useState(getDensity);
  const [notify, setLocalNotify] = useState(getNotifyPref);

  function pickAccent(hex) {
    setAccent(hex);
    setLocalAccent(hex);
  }
  function pickDensity(d) {
    setDensity(d);
    setLocalDensity(d);
  }
  // Ligar pede permissao do navegador (so quando ainda nao decidida); os
  // avisos de OS so aparecem com a aba oculta + permissao concedida.
  function pickNotify(value) {
    setNotifyPref(value);
    setLocalNotify(value);
    if (
      value === 'on'
      && typeof Notification !== 'undefined'
      && Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }

  return (
    <div className="prefs panel" role="dialog" aria-label="Preferências">
      <div className="prefs-head">
        <span className="prefs-title">Preferências</span>
        <button type="button" className="prefs-close" onClick={onClose} aria-label="Fechar">×</button>
      </div>

      <div className="prefs-row">
        <span className="prefs-lbl">Acento</span>
        <div className="prefs-swatches">
          {SWATCHES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={'prefs-sw' + (accent === s.hex ? ' on' : '') + (s.hex ? '' : ' prefs-sw-default')}
              style={s.hex ? { background: s.hex } : undefined}
              title={s.label}
              aria-label={s.label}
              aria-pressed={accent === s.hex}
              onClick={() => pickAccent(s.hex)}
            >
              {s.hex ? null : 'A'}
            </button>
          ))}
        </div>
      </div>

      <div className="prefs-row">
        <span className="prefs-lbl">Espaçamento</span>
        <div className="prefs-seg">
          <button
            type="button"
            className={'prefs-seg-btn' + (density === 'comfortable' ? ' on' : '')}
            onClick={() => pickDensity('comfortable')}
          >
            confortável
          </button>
          <button
            type="button"
            className={'prefs-seg-btn' + (density === 'compact' ? ' on' : '')}
            onClick={() => pickDensity('compact')}
          >
            compacto
          </button>
        </div>
      </div>

      <div className="prefs-row">
        <span className="prefs-lbl">Notificações</span>
        <div className="prefs-seg">
          <button
            type="button"
            className={'prefs-seg-btn' + (notify === 'on' ? ' on' : '')}
            onClick={() => pickNotify('on')}
          >
            avisos do navegador
          </button>
          <button
            type="button"
            className={'prefs-seg-btn' + (notify === 'off' ? ' on' : '')}
            onClick={() => pickNotify('off')}
          >
            desligado
          </button>
        </div>
      </div>

      <p className="prefs-foot dim">muda na hora · salvo entre sessões</p>
    </div>
  );
}
