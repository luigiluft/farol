// FAROL - modulo terminal OPCIONAL (ownership: agente A1).
// Depende de node-pty (optionalDependency) e ws, ambos importados
// dinamicamente com catch: se qualquer um faltar, a Torre vive sem terminal
// e GET /api/terminal/status responde {available:false}. O WebSocket sobe no
// MESMO http server (path /ws/terminal) via attach(httpServer) no index.
// Max 2 PTYs simultaneos; powershell.exe com cwd no home do usuario.

import os from 'node:os';

const WS_PATH = '/ws/terminal';
const MAX_PTYS = 2;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MIN_DIM = 2;
const MAX_COLS = 400;
const MAX_ROWS = 200;
const WS_OPEN = 1;

let ptyLib = null;
let WebSocketServerCtor = null;
let openPtys = 0;

try {
  const ns = await import('node-pty');
  ptyLib = ns.default && typeof ns.default.spawn === 'function' ? ns.default : ns;
  if (typeof ptyLib.spawn !== 'function') ptyLib = null;
} catch {
  ptyLib = null; // node-pty nao compilou/instalou: terminal indisponivel
}

try {
  const ws = await import('ws');
  WebSocketServerCtor = ws.WebSocketServer || (ws.default && ws.default.WebSocketServer) || null;
} catch {
  WebSocketServerCtor = null; // ws ausente: terminal indisponivel
}

function isAvailable() {
  return Boolean(ptyLib && WebSocketServerCtor);
}

// ------------------------------------------------------------------- pty ----

function clampDim(raw, fallback, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_DIM) return fallback;
  return Math.min(n, max);
}

function spawnShell(req) {
  const url = new URL(req.url || WS_PATH, 'http://localhost');
  const cols = clampDim(url.searchParams.get('cols'), DEFAULT_COLS, MAX_COLS);
  const rows = clampDim(url.searchParams.get('rows'), DEFAULT_ROWS, MAX_ROWS);
  return ptyLib.spawn('powershell.exe', ['-NoLogo'], {
    name: 'xterm-color',
    cols,
    rows,
    cwd: os.homedir(),
    env: process.env,
  });
}

function handleMessage(p, data) {
  const text = data.toString('utf8');
  if (text.startsWith('{')) {
    try {
      const msg = JSON.parse(text);
      if (msg && msg.type === 'resize') {
        p.resize(
          clampDim(msg.cols, DEFAULT_COLS, MAX_COLS),
          clampDim(msg.rows, DEFAULT_ROWS, MAX_ROWS)
        );
        return;
      }
    } catch {
      // nao era JSON de controle: trata como texto digitado
    }
  }
  p.write(text);
}

function handleConnection(ws, req) {
  if (openPtys >= MAX_PTYS) {
    ws.close(1013, 'limite de terminais atingido');
    return;
  }
  let p;
  try {
    p = spawnShell(req);
  } catch (err) {
    console.error('[terminal] spawn falhou:', err.message);
    ws.close(1011, 'falha ao abrir shell');
    return;
  }
  openPtys += 1;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    openPtys -= 1;
    try {
      p.kill();
    } catch {
      // pty ja morreu
    }
    try {
      ws.close();
    } catch {
      // ws ja fechado
    }
  };
  p.onData((d) => {
    if (ws.readyState === WS_OPEN) ws.send(d);
  });
  p.onExit(cleanup);
  ws.on('message', (data) => {
    try {
      handleMessage(p, data);
    } catch (err) {
      console.error('[terminal] mensagem falhou:', err.message);
    }
  });
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

// ---------------------------------------------------------------- attach ----

export function attach(httpServer) {
  if (!isAvailable()) {
    console.log('[terminal] indisponivel (node-pty ou ws ausentes); Torre segue sem terminal');
    return;
  }
  try {
    const wss = new WebSocketServerCtor({ server: httpServer, path: WS_PATH });
    wss.on('connection', handleConnection);
    wss.on('error', (err) => console.error('[terminal] wss:', err.message));
    console.log(`[terminal] websocket pronto em ${WS_PATH}`);
  } catch (err) {
    console.error('[terminal] attach falhou:', err.message);
  }
}

// -------------------------------------------------------------- registro ----

export function register(app) {
  app.get('/api/terminal/status', (req, res) => {
    res.json({ available: isAvailable() });
  });
}
