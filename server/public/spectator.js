import { loadSprites, createAvatar, drawBackground } from './arena-avatar.js';

const WORLD_W = 1600, WORLD_H = 1000;
window.__arena = { players: [], connected: false };

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
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.delete(id); }
    document.getElementById('count').textContent = `${players.length} in the room`;
  }

  app.ticker.add((ticker) => { const now = performance.now(); for (const s of sprites.values()) s.update(ticker.deltaMS, now); });

  connect();
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { window.__arena.connected = true; ws.send(JSON.stringify({ t: 'hello', role: 'spectator' })); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'roster' && Array.isArray(m.players)) { window.__arena.players = m.players; sync(m.players); } };
    ws.onclose = () => { window.__arena.connected = false; setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
  }
})();
