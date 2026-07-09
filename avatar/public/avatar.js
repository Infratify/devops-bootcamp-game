import { loadSprites, createAvatar, drawBackground } from './arena-avatar.js';

const WORLD_W = 1600, WORLD_H = 1000;
const SEND_MS = 50;   // matched to the server's 50ms roster broadcast → evenly-spaced snapshots (no aliasing stutter)
window.__arena = { you: null, players: [], room: false };

const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const DIRNAME = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right', '-1,-1': 'upleft', '1,-1': 'upright', '-1,1': 'downleft', '1,1': 'downright' };
const ACTKEY = { ' ': 'jump', Spacebar: 'jump', e: 'interact', E: 'interact', r: 'punch', R: 'punch' };
const ACT_COOLDOWN = 250; // ms between fires of the same held action key

(async () => {
  const app = new PIXI.Application();
  await app.init({ background: '#0a0f22', resizeTo: window, antialias: false });
  document.getElementById('stage').appendChild(app.canvas);
  await loadSprites();

  const world = new PIXI.Container();
  app.stage.addChild(world);
  drawBackground(world);
  const layer = new PIXI.Container();
  layer.sortableChildren = true;
  world.addChild(layer);

  function fit() {
    const s = Math.min(app.screen.width / WORLD_W, app.screen.height / WORLD_H);
    world.scale.set(s);
    world.position.set((app.screen.width - WORLD_W * s) / 2, (app.screen.height - WORLD_H * s) / 2);
  }
  fit();
  window.addEventListener('resize', fit);

  const sprites = new Map();
  let myId = null;
  function sync(players) {
    const now = performance.now();
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let s = sprites.get(p.id);
      if (!s) { s = createAvatar(p); layer.addChild(s.c); s.c.position.set(p.x, p.y); sprites.set(p.id, s); }
      s.pushSnapshot(p.x, p.y, now);
      s.setColour(p.colour); s.setName(p.nama); s.setScore(p.score);
      s.setAction(p.act, p.actSeq);
      s.setYou(p.id === myId);
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.delete(id); }
  }

  app.ticker.add((ticker) => { const now = performance.now(); for (const s of sprites.values()) s.update(ticker.deltaMS, now); });

  let ws = null;
  connect();
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'you') { myId = m.id; window.__arena.you = m; window.__arena.room = m.room; setBanner(m.room); }
      else if (m.t === 'roster' && Array.isArray(m.players)) { window.__arena.players = m.players; sync(m.players); }
      else if (m.t === 'room') { window.__arena.room = m.connected; setBanner(m.connected); }
    };
    ws.onclose = () => { window.__arena.room = false; setBanner(false); setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
  }

  // held-key 8-way input: track pressed keys, send the resultant direction on a tick.
  // Shift = run (bigger server step). Space/E/R = one-shot actions (jump/interact/punch).
  const held = new Set();
  let running = false;
  const actAt = {}; // last-fired ms per action, to rate-limit key-repeat
  function fireAct(name) {
    const now = performance.now();
    if (now - (actAt[name] || 0) < ACT_COOLDOWN) return;
    actAt[name] = now;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'act', name }));
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') { running = true; return; }
    const act = ACTKEY[e.key];
    if (act) { e.preventDefault(); fireAct(act); return; }
    const d = KEYMAP[e.key]; if (!d) return; e.preventDefault(); held.add(d);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') { running = false; return; }
    const d = KEYMAP[e.key]; if (!d) return; e.preventDefault(); held.delete(d);
  });
  window.addEventListener('blur', () => { held.clear(); running = false; }); // focus loss must not leave a key stuck
  function currentDir() {
    const ax = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const ay = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    return DIRNAME[`${ax},${ay}`];
  }
  setInterval(() => {
    const dir = currentDir();
    if (dir && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'move', dir, run: running }));
  }, SEND_MS);

  function setBanner(connected) {
    const b = document.getElementById('banner');
    if (connected) b.classList.add('hidden');
    else { b.classList.remove('hidden'); b.textContent = "You're set up — waiting for the room…"; }
  }
})();
