import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Room } from './room.js';
import { parse, rosterMsg, welcomeMsg } from './messages.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function send(ws, msg) { try { if (ws.readyState === 1) ws.send(msg); } catch { /* ignore */ } }

export function createServer({ port = 3000, publicDir = PUBLIC } = {}) {
  const room = new Room();
  const clients = new Map(); // ws -> { id, role }

  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent((req.url || '/').split('?')[0]);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.join(publicDir, path.normalize(rel));
      if (!file.startsWith(publicDir)) { res.writeHead(403); return res.end('forbidden'); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });

  const wss = new WebSocketServer({ server });
  let dirty = false;
  const tick = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const msg = rosterMsg(room.roster());
    for (const ws of clients.keys()) send(ws, msg);
  }, 50);

  wss.on('connection', (ws) => {
    clients.set(ws, { id: null, role: null });
    ws.on('message', (data) => {
      const m = parse(data.toString());
      if (!m) return;
      const c = clients.get(ws);
      if (!c) return;
      try {
        if (m.t === 'hello' && m.role === 'spectator') { c.role = 'spectator'; send(ws, rosterMsg(room.roster())); }
        else if (m.t === 'join') { if (!c.id) c.id = room.nextId(); c.role = 'avatar'; room.join(c.id, m); send(ws, welcomeMsg(c.id)); dirty = true; }
        else if (m.t === 'update' && c.id) { room.update(c.id, m); dirty = true; }
      } catch { /* one client must never crash the hub */ }
    });
    const drop = () => { const c = clients.get(ws); if (c && c.id) { room.leave(c.id); dirty = true; } clients.delete(ws); };
    ws.on('close', drop);
    ws.on('error', drop);
  });

  server.listen(port);
  return {
    get port() { const a = server.address(); return a && typeof a === 'object' ? a.port : port; },
    room, server, wss,
    close() { clearInterval(tick); wss.close(); return new Promise((r) => server.close(r)); },
  };
}
