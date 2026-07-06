const WORLD_W = 1600, WORLD_H = 1000;
window.__arena = { you: null, players: [], room: false };

const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };

(async () => {
  const app = new PIXI.Application();
  await app.init({ background: '#0b1020', resizeTo: window, antialias: true });
  document.getElementById('stage').appendChild(app.canvas);

  const world = new PIXI.Container();
  app.stage.addChild(world);
  drawBackground(world);
  const layer = new PIXI.Container();
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
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let s = sprites.get(p.id);
      if (!s) { s = makeAvatar(p); layer.addChild(s.c); s.c.position.set(p.x, p.y); sprites.set(p.id, s); }
      s.target = { x: p.x, y: p.y };
      s.setColour(p.colour); s.setName(p.nama); s.setScore(p.score);
      s.setYou(p.id === myId);
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.delete(id); }
  }

  app.ticker.add(() => {
    for (const s of sprites.values()) { s.c.x += (s.target.x - s.c.x) * 0.25; s.c.y += (s.target.y - s.c.y) * 0.25; }
  });

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

  window.addEventListener('keydown', (e) => {
    const dir = KEYMAP[e.key];
    if (!dir) return;
    e.preventDefault();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'move', dir }));
  });

  function setBanner(connected) {
    const b = document.getElementById('banner');
    if (connected) b.classList.add('hidden');
    else { b.classList.remove('hidden'); b.textContent = "You're set up — waiting for the room…"; }
  }
})();

function drawBackground(world) {
  const g = new PIXI.Graphics();
  g.rect(0, 0, WORLD_W, WORLD_H).fill(0x0e1530);
  for (let x = 0; x <= WORLD_W; x += 80) g.moveTo(x, 0).lineTo(x, WORLD_H);
  for (let y = 0; y <= WORLD_H; y += 80) g.moveTo(0, y).lineTo(WORLD_W, y);
  g.stroke({ color: 0x1b2a55, width: 1, alpha: 0.6 });
  world.addChild(g);
}
function tintOf(colour) { try { return new PIXI.Color(colour).toNumber(); } catch { return new PIXI.Color('aqua').toNumber(); } }

function makeAvatar(p) {
  const c = new PIXI.Container();
  const ring = new PIXI.Graphics().circle(0, 2, 34).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
  ring.visible = false;
  const glow = new PIXI.Graphics().circle(0, 0, 30).fill({ color: 0xffffff, alpha: 0.12 });
  const body = new PIXI.Graphics().roundRect(-20, -20, 40, 44, 16).fill(0xffffff);
  const eyeL = new PIXI.Graphics().circle(-7, -4, 4).fill(0x0b1020);
  const eyeR = new PIXI.Graphics().circle(7, -4, 4).fill(0x0b1020);
  const label = new PIXI.Text({ text: p.nama, style: { fill: 0xffffff, fontSize: 18, fontWeight: '700', stroke: { color: 0x0b1020, width: 4 } } });
  label.anchor.set(0.5, 1); label.position.set(0, -30);
  const score = new PIXI.Text({ text: String(p.score), style: { fill: 0xbfe3ff, fontSize: 13, stroke: { color: 0x0b1020, width: 3 } } });
  score.anchor.set(0.5, 0); score.position.set(0, 26);
  c.addChild(ring, glow, body, eyeL, eyeR, label, score);
  return {
    c, target: { x: p.x, y: p.y },
    setColour: (col) => { body.tint = tintOf(col); },
    setName: (n) => { if (label.text !== n) label.text = n; },
    setScore: (s) => { const t = String(s); if (score.text !== t) score.text = t; },
    setYou: (yes) => { ring.visible = yes; },
  };
}
