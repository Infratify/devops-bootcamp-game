import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { move, isDir } from './movement.js';
import { STEP, RUN_STEP } from './constants.js';
import { loadOrInit, resolveColour, spawn } from './character.js';
import { nextWander, bounce } from './autopilot.js';
import { parse, isMove, isAct, youMsg, rosterMsg, roomMsg } from './messages.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const AUTOPILOT_MS = 50; // NPC wander tick, matched to the server's 50ms roster broadcast
const send = (ws, msg) => { try { if (ws.readyState === 1) ws.send(msg); } catch { /* ignore */ } };
const rid = () => 'a' + Math.random().toString(36).slice(2, 10);
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

export async function startAvatar({ env = {}, storeFactory, roomFactory, port = 8080, publicDir = PUBLIC } = {}) {
  const envName = typeof env.NAME === 'string' && env.NAME.trim() ? env.NAME.trim() : null;
  const npc = truthy(env.NPC);

  // NPC (crowd bot): self-contained, no profile store, no volume, no persistence.
  // Identity is env-only (NAME/COLOR) and it just wanders + joins the room — so a
  // demo compose can spin up N of these with no redis. The redis-by-name lesson
  // (LO3) is unchanged: only the normal, non-NPC path requires the profile store.
  let store = null;
  let self;
  if (npc) {
    const s = spawn();
    self = {
      id: rid(), nama: envName || `bot-${Math.random().toString(36).slice(2, 6)}`,
      colour: resolveColour(env.COLOR), x: s.x, y: s.y, score: 0, act: null, actSeq: 0,
    };
  } else {
    // A second avatar on the same machine needs its own save file inside the
    // shared remember-box (bare keys would clobber x/y/score). NAME is that key:
    // "your name IS your save file" — the student already sets NAME for the
    // nameplate, so it does double duty and no SLOT is needed. SLOT stays only as
    // an explicit override (two avatars, SAME name). Neither set = bare keys, the
    // unchanged Docker 3 flow.
    const slot = typeof env.SLOT === 'string' ? env.SLOT.trim() : '';
    const key = slot || envName || '';                                         // SLOT wins, else NAME, else bare
    store = await storeFactory(env.REDIS_HOST || 'profile', key ? `${key}:` : '');   // throws → loud fail in index.js
    const char = await loadOrInit(store, { colour: env.COLOR });
    // NAME is also written through as `nama`, so the save file still remembers it
    // after the env is gone. The store copy stays the durable home.
    if (envName && envName !== char.nama) { await store.set('nama', envName); await store.save(); }
    self = { id: rid(), nama: envName || char.nama || 'tanpa-nama', colour: char.colour, x: char.x, y: char.y, score: char.score, act: null, actSeq: 0 };
    if (!envName && !char.nama) {
      console.warn('[arena] No "nama" in your remember-box yet. Set one with:\n  docker exec profile redis-cli SET nama "YourName"');
    }
  }

  let serverRoster = [];
  let roomConnected = false;
  let saveTimer = null;
  let autopilotTimer = null;
  function persist() {
    if (!store) return;                          // NPC has no store — nothing to persist
    store.set('x', String(Math.round(self.x)));
    store.set('y', String(Math.round(self.y)));
    store.set('score', String(self.score));
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; store.save(); }, 750);
  }

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
  const browsers = new Set();
  const rosterForBrowser = () => {
    if (roomConnected && serverRoster.length) {
      if (!serverRoster.some((p) => p.id === self.id)) return [...serverRoster, self];
      // Overlay our own latest action onto the echoed self entry so the driver sees
      // their jump/punch/interact instantly (no round-trip, and even against an old
      // server that strips act/actSeq). Others still get it via the shared roster.
      return serverRoster.map((p) => (p.id === self.id ? { ...p, act: self.act, actSeq: self.actSeq } : p));
    }
    return [self];
  };
  const pushRoster = () => { const msg = rosterMsg(rosterForBrowser()); for (const b of browsers) send(b, msg); };
  const pushRoom = () => { const msg = roomMsg(roomConnected); for (const b of browsers) send(b, msg); };

  wss.on('connection', (ws) => {
    browsers.add(ws);
    send(ws, youMsg({ id: self.id, nama: self.nama, colour: self.colour, x: self.x, y: self.y, score: self.score, room: roomConnected }));
    send(ws, rosterMsg(rosterForBrowser()));
    ws.on('message', (data) => {
      const m = parse(data.toString());
      if (isMove(m) && isDir(m.dir)) {
        const p = move({ x: self.x, y: self.y }, m.dir, m.run === true ? RUN_STEP : STEP);
        self.x = p.x; self.y = p.y; self.score += 1;
        persist();
        room.sendUpdate({ x: self.x, y: self.y, score: self.score });
        pushRoster();
      } else if (isAct(m)) {
        // Cosmetic one-shot (jump/punch/interact): no position/score change. A bumped
        // actSeq is the edge every client uses to play the animation exactly once.
        self.act = m.name; self.actSeq += 1;
        room.sendUpdate({ act: self.act, actSeq: self.actSeq });
        pushRoster();
      }
    });
    ws.on('close', () => browsers.delete(ws));
    ws.on('error', () => browsers.delete(ws));
  });

  const room = roomFactory(env.SERVER, {
    getJoinPayload: () => ({ nama: self.nama, colour: self.colour, x: self.x, y: self.y, score: self.score }),
    onWelcome: (id) => {
      self.id = id;
      const msg = youMsg({ id: self.id, nama: self.nama, colour: self.colour, x: self.x, y: self.y, score: self.score, room: roomConnected });
      for (const b of browsers) send(b, msg);
      pushRoster();
    },
    onRoster: (players) => { serverRoster = players; pushRoster(); },
    onStatus: (c) => { roomConnected = c; pushRoom(); pushRoster(); },
  });

  await new Promise((r) => server.listen(port, r));

  if (npc) {
    // Drive the bot on the same 50ms cadence the server broadcasts, so viewers
    // interpolate it exactly like a student avatar. move()/room relay/pushRoster
    // are the same paths the browser move handler uses — just self-driven here.
    let wander = null;
    autopilotTimer = setInterval(() => {
      const step = nextWander(wander, Math.random);
      wander = step.state;
      if (step.dir) {
        const p = move({ x: self.x, y: self.y }, step.dir, step.run ? RUN_STEP : STEP);
        if (p.x === self.x && p.y === self.y) {
          wander = bounce(wander);                       // walked into a wall → reroll next tick
        } else {
          self.x = p.x; self.y = p.y; self.score += 1;
          room.sendUpdate({ x: self.x, y: self.y, score: self.score });
        }
      }
      if (step.act) {
        self.act = step.act; self.actSeq += 1;
        room.sendUpdate({ act: self.act, actSeq: self.actSeq });
      }
      pushRoster();
    }, AUTOPILOT_MS);
  }

  return {
    get port() { const a = server.address(); return a && typeof a === 'object' ? a.port : port; },
    state: () => ({ self: { ...self }, roomConnected, serverRoster }),
    async close() {
      if (autopilotTimer) { clearInterval(autopilotTimer); autopilotTimer = null; }
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (store) await store.save();
      room.close();
      wss.close();
      await new Promise((r) => server.close(r));
      await store?.quit?.();
    },
  };
}
