// FAROL - modulo live-browser (o "olho da IA", AO VIVO via CDP). Conecta no
// Chrome com --remote-debugging-port (default 9222, override TORRE_CDP_PORT):
// /json/list lista os targets 'page'; pra cada frame abre uma sessao CDP
// efetera pelo webSocketDebuggerUrl e chama Page.captureScreenshot (mais
// simples/robusto que startScreencast — sem loop no server: o HEARTBEAT e do
// client, que faz polling ~1s do /api/live/frame). Sem Chrome-debug no ar =>
// degrade limpo: /status devolve {available:false} e /frame devolve 503, nunca
// derruba o server nem trava (timeout curto). Usa a lib 'ws' (ja em deps: a
// sessao CDP exige WebSocket; captureScreenshot nao vem por HTTP puro).

import http from 'node:http';
import { WebSocket } from 'ws';

const CDP_PORT = Number(process.env.TORRE_CDP_PORT) || 9222;
const CDP_HOST = '127.0.0.1';
const CDP_TIMEOUT_MS = 1500; // descoberta (/json/list): sem Chrome-debug, falha rapido
const SHOT_TIMEOUT_MS = 5000; // screenshot: 1o frame de tab background/throttled passa de 1.5s (renderer acorda devagar)
const SHOT_QUALITY = 55;

// GET http com JSON e timeout curto; qualquer nao-200/erro => rejeita.
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: CDP_HOST, port: CDP_PORT, path: pathname, timeout: CDP_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('cdp http ' + res.statusCode));
        return;
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('cdp timeout')));
    req.on('error', reject);
  });
}

// Targets 'page' navegaveis (com wsUrl); [] em qualquer erro.
async function listPages() {
  const list = await getJson('/json/list');
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && t.type === 'page' && t.webSocketDebuggerUrl);
}

// Abre uma sessao CDP efetera e captura UM screenshot JPEG. Timeout curto e
// cleanup garantido: promessa resolve/rejeita uma vez so, sempre fechando o ws.
function captureScreenshot(wsUrl) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let settled = false;
    let timer = null;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (ws) ws.close(); } catch { /* ja fechado */ }
      if (err) reject(err); else resolve(val);
    };
    timer = setTimeout(() => finish(new Error('cdp screenshot timeout')), SHOT_TIMEOUT_MS);
    try { ws = new WebSocket(wsUrl); } catch (e) { finish(e); return; }
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.captureScreenshot',
        params: { format: 'jpeg', quality: SHOT_QUALITY },
      }));
    });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.id !== 1) return;
      if (m.error) return finish(new Error(m.error.message || 'cdp erro'));
      const data = m.result && m.result.data;
      if (!data) return finish(new Error('cdp sem data'));
      finish(null, Buffer.from(data, 'base64'));
    });
    ws.on('error', (e) => finish(e));
    ws.on('close', () => finish(new Error('cdp ws fechou antes do frame')));
  });
}

// ------------------------------------------------------------- registro ----

export function register(app) {
  // Disponibilidade + targets. NUNCA 500: sem Chrome-debug => {available:false}.
  app.get('/api/live/status', async (req, res) => {
    try {
      const pages = await listPages();
      res.json({
        available: pages.length > 0,
        targets: pages.map((t) => ({ id: t.id, title: t.title || '', url: t.url || '' })),
      });
    } catch {
      res.json({ available: false, targets: [] });
    }
  });

  // JPEG atual do target pedido (ou o 1o page). Erro => 503, server segue vivo.
  app.get('/api/live/frame', async (req, res) => {
    try {
      const wanted = String(req.query.target || '');
      const pages = await listPages();
      if (pages.length === 0) return res.status(503).json({ error: 'nenhum browser com debug port' });
      const page = pages.find((t) => t.id === wanted) || pages[0];
      const jpeg = await captureScreenshot(page.webSocketDebuggerUrl);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      res.send(jpeg);
    } catch (err) {
      if (!res.headersSent) res.status(503).json({ error: 'live indisponivel' });
    }
  });
}
