// FAROL - terminal LOCAL interativo (PTY xterm via /ws/terminal). Extraido
// de Terminal.jsx sem mudanca de comportamento: a aba 'Local' da F7 continua
// importando LocalPane daqui e o Cockpit o carrega LAZY (o bundle do xterm e
// ~300KB e NAO pode entrar no chunk inicial). Tema light/dark do xterm troca
// em runtime via getTheme()/onThemeChange (contrato C1.2).
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './terminal.css'; // .local-pane/.term-host: painel auto-contido (mobile monta LocalPane sem Terminal.jsx)
import { getTheme, onThemeChange } from './theme.js';

const SERVER_PORT = 7777;

// Temas do xterm (JS puro: o canvas do xterm nao le CSS vars).
// dark = paleta historica da Torre; light = contraparte C1 (azul-papel frio).
const XTERM_THEMES = {
  dark: {
    background: '#0a0e12',
    foreground: '#c9d4dd',
    cursor: '#3ddc84',
    cursorAccent: '#0a0e12',
    selectionBackground: 'rgba(61, 220, 132, 0.25)',
    black: '#11161d',
    red: '#ff5f56',
    green: '#3ddc84',
    yellow: '#ffb454',
    blue: '#82aaff',
    magenta: '#c792ea',
    cyan: '#4dd0e1',
    white: '#c9d4dd',
    brightBlack: '#5d6b78',
    brightRed: '#ff8a80',
    brightGreen: '#69f0ae',
    brightYellow: '#ffd180',
    brightBlue: '#a6c8ff',
    brightMagenta: '#e1bee7',
    brightCyan: '#84ffff',
    brightWhite: '#e8eef3',
  },
  light: {
    background: '#eef2f7',
    foreground: '#25303b',
    cursor: '#0c9e62',
    cursorAccent: '#eef2f7',
    selectionBackground: 'rgba(12, 158, 98, 0.25)',
    black: '#0f1822',
    red: '#cc3b32',
    green: '#0c9e62',
    yellow: '#b26c0e',
    blue: '#2f6fd0',
    magenta: '#7a58c9',
    cyan: '#0a7f93',
    white: '#8896a6',
    brightBlack: '#67768a',
    brightRed: '#e0635a',
    brightGreen: '#0fb573',
    brightYellow: '#cf8418',
    brightBlue: '#4d85e8',
    brightMagenta: '#9577d6',
    brightCyan: '#0d99b1',
    brightWhite: '#0f1822',
  },
};

const STATUS_LABELS = {
  conectando: 'conectando...',
  aberto: 'sessão ativa',
  fechado: 'sessão encerrada',
  erro: 'falha na conexão',
};

// Barra de teclas touch (mobile): teclas que o teclado do iOS nao tem mas que o
// claude/TUI precisa (Esc, Tab, Ctrl-C, setas). Sequencias de controle cruas.
const TOUCH_KEYS = [
  { label: 'esc', seq: '\x1b' },
  { label: 'tab', seq: '\t' },
  { label: '⌃C', seq: '\x03' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
];

function TermKeys({ onSeq }) {
  return (
    <div className="term-keys" role="toolbar" aria-label="Teclas do terminal">
      {TOUCH_KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          className="term-key"
          // preventDefault no mousedown NAO rouba o foco do xterm (teclado iOS fica aberto)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSeq(k.seq)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

// aba local: PTY xterm via WebSocket (logica historica preservada)
export function LocalPane({ visible, onStatus, touchKeys = false, pendingCmd = null, onCmdSent }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const [gen, setGen] = useState(0);
  const [status, setStatus] = useState('conectando');

  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const { term, fit, ws, observer } = bootTerminal(hostRef.current, setStatus);
    termRef.current = term;
    fitRef.current = fit;
    wsRef.current = ws;
    const offTheme = safeOnThemeChange((t) => {
      term.options.theme = xtermTheme(t);
    });
    return () => {
      offTheme();
      observer.disconnect();
      try {
        ws.close();
      } catch {
        // ja fechado
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [gen]);

  // Ao voltar para a aba (montagem persistente com display:none), refit+focus.
  useEffect(() => {
    if (!visible) return;
    if (fitRef.current) safeFit(fitRef.current);
    if (termRef.current) termRef.current.focus();
  }, [visible]);

  // Injeta um comando externo (ex.: retomar sessao) UMA vez, quando o WS abrir.
  // status na dep faz disparar assim que conecta, se o cmd chegou durante 'conectando'.
  useEffect(() => {
    if (!pendingCmd) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pendingCmd + '\r');
      if (termRef.current) termRef.current.focus();
      if (onCmdSent) onCmdSent();
    }
  }, [pendingCmd, status]);

  // envia sequencia crua pro PTY e devolve o foco pro terminal
  const sendSeq = (seq) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(seq);
    if (termRef.current) termRef.current.focus();
  };

  const dead = status === 'fechado' || status === 'erro';
  return (
    <div className={'local-pane' + (visible ? '' : ' hidden')}>
      <div className="term-head mono">
        <span className="term-title">terminal · powershell</span>
        <span className={'term-status st-' + status}>{STATUS_LABELS[status] || status}</span>
        {dead && (
          <button type="button" className="term-reconnect" onClick={() => setGen((g) => g + 1)}>
            reconectar
          </button>
        )}
      </div>
      <div ref={hostRef} className="term-host" />
      {touchKeys && <TermKeys onSeq={sendSeq} />}
    </div>
  );
}

// setup: cria o xterm com o tema corrente, conecta o WS e observa resize
function bootTerminal(host, setStatus) {
  const term = new XTerm({
    theme: xtermTheme(safeGetTheme()),
    fontFamily: "'JetBrains Mono', Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 4000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  safeFit(fit);
  const ws = connectWs(term, setStatus);
  const observer = new ResizeObserver(() => safeFit(fit));
  observer.observe(host);
  return { term, fit, ws, observer };
}

function connectWs(term, setStatus) {
  setStatus('conectando');
  const ws = new WebSocket(terminalWsUrl(term.cols, term.rows));
  ws.onopen = () => {
    setStatus('aberto');
    term.focus();
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') term.write(ev.data);
    else if (ev.data instanceof Blob) ev.data.text().then((t) => term.write(t));
  };
  ws.onclose = () => setStatus('fechado');
  ws.onerror = () => setStatus('erro');
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  });
  return ws;
}

// Em dev o Vite roda na 5173 sem proxy de WebSocket: fala direto com a 7777.
// Em prod a pagina ja vem da 7777, entao usa o proprio host.
function terminalWsUrl(cols, rows) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = import.meta.env.DEV
    ? window.location.hostname + ':' + SERVER_PORT
    : window.location.host;
  return proto + '://' + host + '/ws/terminal?cols=' + cols + '&rows=' + rows;
}

// fit() lanca se o container estiver oculto/sem tamanho (tab em display:none).
function safeFit(fit) {
  try {
    fit.fit();
  } catch {
    // container sem dimensao no momento; o proximo resize/activate refaz
  }
}

// tema (contrato C1.2) com guarda: costura nunca derruba o terminal
function xtermTheme(t) {
  return XTERM_THEMES[t] || XTERM_THEMES.dark;
}

function safeGetTheme() {
  try {
    const t = getTheme();
    return t === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function safeOnThemeChange(cb) {
  try {
    const off = onThemeChange(cb);
    return typeof off === 'function' ? off : () => {};
  } catch {
    return () => {};
  }
}

export default LocalPane;
