# Arena Avatar Sprite Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural rounded-rect avatars with the recovered 16×32 chibi pixel sprites, giving smooth 8-direction movement + facing and a per-player colour cue (feet ring + nameplate), on both the projector and student views.

**Architecture:** A pure, unit-tested `arena-anim.js` derives facing/animation from movement; a shared `arena-avatar.js` factory renders each avatar (ring + sprite + nameplate) with PixiJS; both view scripts consume the factory. Diagonal movement is added by extending the existing `{t:'move',dir}` direction set — no protocol, roster, or server-logic change. Sprite sheets and shared JS are vendored (duplicated) into each image's `public/`, exactly like `pixi.min.js`.

**Tech Stack:** Node 20 (ESM), PixiJS v8 (vendored global `PIXI`), `node:test`, plain browser ES modules.

## Global Constraints

- **Frame slicing (verified):** sprites are **32×32**; each sheet is `128×160` = **4 frames (cols) × 5 facing rows**. Rows: `0`=front/S, `1`=¾-front, `2`=side, `3`=¾-back, `4`=back/N. **Native turned rows face RIGHT** → rightward heading = no flip, leftward = `scale.x < 0`. Anchor sprites at centre-bottom `(0.5, 1)`.
- **No student-facing contract change:** do not alter image names, env (`COLOR`/`SERVER`/`REDIS_HOST`/`PORT`), ports (`8080`/`3000`), volume (`me`), network (`arena`), the roster shape `{id,nama,colour,x,y,score}`, or the internal `{t:'move',dir}` message shape.
- **Keep intact for tests/e2e:** DOM ids `#stage`, `#count`, `#banner`, `#hint`; the `<title>Arena…` text; one-step-per-`move`-message server logic; `scripts/e2e.sh` must pass unchanged.
- **Both `avatar/` and `server/` are ESM** (`"type":"module"`), PixiJS `^8.6.0`. Shared files (`arena-anim.js`, `arena-avatar.js`, sprite PNGs) are **byte-identical copies** in `avatar/public/` and `server/public/` (no shared build; vendored pattern).
- World is `1600×1000`; `STEP=12`, `AVATAR_R=22` (from `avatar/src/constants.js`).
- Commit after each task. DRY, YAGNI, TDD.

---

### Task 1: Vendored sprite assets + .gitignore

**Files:**
- Create: `avatar/public/sprites/char-idle.png`, `avatar/public/sprites/char-walk.png`
- Create: `server/public/sprites/char-idle.png`, `server/public/sprites/char-walk.png`
- Modify: `.gitignore`

**Interfaces:**
- Produces: four `128×160` PNG sheets served at `sprites/char-idle.png` and `sprites/char-walk.png` by each image's static file handler.

- [ ] **Step 1: Copy the two 16×32 sheets into both publics**

```bash
cd /home/debian/repo/devops-bootcamp-game
mkdir -p avatar/public/sprites server/public/sprites
cp "assets/16x32/16x32 Idle-Sheet.png" avatar/public/sprites/char-idle.png
cp "assets/16x32/16x32 Walk-Sheet.png" avatar/public/sprites/char-walk.png
cp "assets/16x32/16x32 Idle-Sheet.png" server/public/sprites/char-idle.png
cp "assets/16x32/16x32 Walk-Sheet.png" server/public/sprites/char-walk.png
```

- [ ] **Step 2: Verify all four are valid 128×160 PNGs**

```bash
python3 - <<'PY'
from struct import unpack
paths=['avatar/public/sprites/char-idle.png','avatar/public/sprites/char-walk.png',
       'server/public/sprites/char-idle.png','server/public/sprites/char-walk.png']
for p in paths:
    d=open(p,'rb').read(24)
    assert d[:8]==b'\x89PNG\r\n\x1a\n', p+' not a PNG'
    w,h=unpack('>II',d[16:24]); print(p,w,h); assert (w,h)==(128,160), p
print('OK')
PY
```
Expected: four lines then `OK`.

- [ ] **Step 3: Ignore the raw sources**

Add to `.gitignore` (append these lines):

```
assets.zip
st.mp3
/assets/
```

- [ ] **Step 4: Commit**

```bash
git add avatar/public/sprites server/public/sprites .gitignore
git commit -m "feat(assets): vendor 16x32 chibi idle/walk sheets into both images"
```

---

### Task 2: Pure animation module `arena-anim.js` + tests

**Files:**
- Create: `avatar/public/arena-anim.js`
- Create: `server/public/arena-anim.js` (identical copy)
- Test: `avatar/test/anim.test.js`

**Interfaces:**
- Produces:
  - `facingFromVelocity(dx, dy, prev = {row:0,flip:false}, diagRatio = 0.4) → {row, flip}`
  - `isMoving(dx, dy, eps = 0.6) → boolean`
  - `frameAt(elapsedMs, fps, nFrames = 4) → number`

- [ ] **Step 1: Write the failing test**

Create `avatar/test/anim.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facingFromVelocity, isMoving, frameAt } from '../public/arena-anim.js';

test('facingFromVelocity cardinals', () => {
  assert.deepEqual(facingFromVelocity(5, 0), { row: 2, flip: false });   // E
  assert.deepEqual(facingFromVelocity(-5, 0), { row: 2, flip: true });   // W
  assert.deepEqual(facingFromVelocity(0, -5), { row: 4, flip: false });  // N = back row
  assert.deepEqual(facingFromVelocity(0, 5), { row: 0, flip: false });   // S = front row
});

test('facingFromVelocity diagonals (native rows face right)', () => {
  assert.deepEqual(facingFromVelocity(5, 5), { row: 1, flip: false });   // SE = ¾-front right
  assert.deepEqual(facingFromVelocity(-5, 5), { row: 1, flip: true });   // SW
  assert.deepEqual(facingFromVelocity(5, -5), { row: 3, flip: false });  // NE = ¾-back right
  assert.deepEqual(facingFromVelocity(-5, -5), { row: 3, flip: true });  // NW
});

test('facingFromVelocity ratio boundary', () => {
  assert.deepEqual(facingFromVelocity(10, 3), { row: 2, flip: false }); // 0.3 < 0.4 → side
  assert.deepEqual(facingFromVelocity(10, 5), { row: 1, flip: false }); // 0.5 > 0.4 → diagonal
});

test('facingFromVelocity zero delta keeps prev', () => {
  const prev = { row: 3, flip: true };
  assert.deepEqual(facingFromVelocity(0, 0, prev), prev);
});

test('isMoving threshold', () => {
  assert.equal(isMoving(0, 0), false);
  assert.equal(isMoving(0.3, 0.3), false); // 0.18 < 0.36
  assert.equal(isMoving(1, 0), true);
});

test('frameAt wraps 0..3', () => {
  assert.equal(frameAt(0, 8), 0);
  assert.equal(frameAt(125, 8), 1);
  assert.equal(frameAt(500, 8), 0); // 4 % 4
  assert.equal(frameAt(625, 8), 1); // 5 % 4
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd avatar && node --test test/anim.test.js`
Expected: FAIL — cannot find module `../public/arena-anim.js`.

- [ ] **Step 3: Write the module**

Create `avatar/public/arena-anim.js`:

```js
// Pure movement→animation logic. No PIXI, no DOM. Unit-tested in avatar/test/anim.test.js.
// Sheet rows: 0=front(S) 1=¾-front 2=side 3=¾-back 4=back(N). Native turned rows face RIGHT.

export function facingFromVelocity(dx, dy, prev = { row: 0, flip: false }, diagRatio = 0.4) {
  if (dx === 0 && dy === 0) return prev;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.min(ax, ay) > Math.max(ax, ay) * diagRatio) {
    return { row: dy > 0 ? 1 : 3, flip: dx < 0 }; // ¾: down-diag=row1, up-diag=row3; mirror leftward
  }
  if (ax >= ay) return { row: 2, flip: dx < 0 };   // side; native faces right, mirror leftward
  return { row: dy < 0 ? 4 : 0, flip: false };      // up = back row, down = front row
}

export function isMoving(dx, dy, eps = 0.6) {
  return (dx * dx + dy * dy) > eps * eps;
}

export function frameAt(elapsedMs, fps, nFrames = 4) {
  return Math.floor((elapsedMs * fps) / 1000) % nFrames;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd avatar && node --test test/anim.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Copy the module to the server public (identical)**

```bash
cp avatar/public/arena-anim.js server/public/arena-anim.js
diff avatar/public/arena-anim.js server/public/arena-anim.js && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 6: Commit**

```bash
git add avatar/public/arena-anim.js server/public/arena-anim.js avatar/test/anim.test.js
git commit -m "feat(anim): pure 8-way facing/animation logic + tests"
```

---

### Task 3: Diagonal movement in `movement.js` + tests

**Files:**
- Modify: `avatar/src/movement.js`
- Test: `avatar/test/movement.test.js` (extend)

**Interfaces:**
- Consumes: `STEP`, `AVATAR_R`, `WORLD_W`, `WORLD_H` from `avatar/src/constants.js`.
- Produces: `isDir(dir)` and `move(pos, dir)` now accept `upleft`/`upright`/`downleft`/`downright`; diagonal per-axis step is `D = round(STEP * √½)` so a diagonal step ≈ a cardinal step (not √2 larger). Cardinal behaviour unchanged.

- [ ] **Step 1: Add failing diagonal tests**

Append to `avatar/test/movement.test.js`:

```js
test('isDir accepts diagonals', () => {
  assert.equal(isDir('upright'), true);
  assert.equal(isDir('downleft'), true);
});
test('diagonal move steps both axes, normalized', () => {
  const D = Math.round(STEP * Math.SQRT1_2);
  assert.deepEqual(move({ x: 800, y: 500 }, 'upright'), { x: 800 + D, y: 500 - D });
  assert.deepEqual(move({ x: 800, y: 500 }, 'downleft'), { x: 800 - D, y: 500 + D });
  assert.ok(D < STEP);                                  // each axis < a cardinal step
  assert.ok(Math.abs(D * Math.SQRT2 - STEP) <= 1);      // euclidean ≈ STEP, not √2 larger
});
test('diagonal move clamps to bounds', () => {
  assert.deepEqual(move({ x: AVATAR_R, y: AVATAR_R }, 'upleft'), { x: AVATAR_R, y: AVATAR_R });
});
```

- [ ] **Step 2: Run to verify the new tests fail (existing still pass)**

Run: `cd avatar && node --test test/movement.test.js`
Expected: the three new tests FAIL (`isDir('upright')` false / undefined `DIRS['upright']`); the original tests PASS.

- [ ] **Step 3: Update `movement.js`**

Replace the entire contents of `avatar/src/movement.js` with:

```js
import { WORLD_W, WORLD_H, STEP, AVATAR_R } from './constants.js';

const D = Math.round(STEP * Math.SQRT1_2); // diagonal per-axis step (normalized so diag ≈ STEP)
const DIRS = {
  up: [0, -STEP], down: [0, STEP], left: [-STEP, 0], right: [STEP, 0],
  upleft: [-D, -D], upright: [D, -D], downleft: [-D, D], downright: [D, D],
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function isDir(d) { return Object.prototype.hasOwnProperty.call(DIRS, d); }

export function move(pos, dir) {
  if (!isDir(dir)) return { x: pos.x, y: pos.y };
  const v = DIRS[dir];
  return {
    x: clamp(pos.x + v[0], AVATAR_R, WORLD_W - AVATAR_R),
    y: clamp(pos.y + v[1], AVATAR_R, WORLD_H - AVATAR_R),
  };
}
```

(Note: `DIRS` values are now pre-scaled deltas, so `move` adds `v[0]`/`v[1]` directly. Cardinal results are unchanged: `right` = `[STEP,0]` → `+12`.)

- [ ] **Step 4: Run the movement suite — all pass**

Run: `cd avatar && node --test test/movement.test.js`
Expected: PASS (original + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add avatar/src/movement.js avatar/test/movement.test.js
git commit -m "feat(movement): add normalized diagonal directions for 8-way movement"
```

---

### Task 4: Shared avatar factory `arena-avatar.js`

**Files:**
- Create: `avatar/public/arena-avatar.js`
- Create: `server/public/arena-avatar.js` (identical copy)

**Interfaces:**
- Consumes: global `PIXI` (from `vendor/pixi.min.js`); `facingFromVelocity`, `isMoving`, `frameAt` from `./arena-anim.js`; the sprite PNGs at `sprites/char-idle.png` / `sprites/char-walk.png`.
- Produces:
  - `async loadSprites(base = 'sprites/')` — loads both sheets, sets nearest scaling, builds the `5×4` texture tables. Must be awaited once before `createAvatar`.
  - `createAvatar(p, opts = {}) → { c, target, setColour, setName, setScore, setYou, update(deltaMS) }` where `p = {nama, colour, x, y, score}` and `c` is a `PIXI.Container`.
  - `drawBackground(world)` — draws the polished room into a `PIXI.Container`.

- [ ] **Step 1: Write the factory module**

Create `avatar/public/arena-avatar.js`:

```js
// Shared avatar renderer. Uses global PIXI (vendor/pixi.min.js) + pure arena-anim.js.
// Byte-identical copy in avatar/public/ and server/public/ (vendored, like pixi.min.js).
import { facingFromVelocity, isMoving, frameAt } from './arena-anim.js';

const FRAME = 32, ROWS = 5, COLS = 4;
const SPRITE_SCALE = 3;              // 32px art → 96px on screen
const WALK_FPS = 8, IDLE_FPS = 4;
const WORLD_W = 1600, WORLD_H = 1000;

let TEX = null; // { idle: Texture[row][col], walk: Texture[row][col] }

function sliceSheet(tex) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const cols = [];
    for (let c = 0; c < COLS; c++) {
      cols.push(new PIXI.Texture({
        source: tex.source,
        frame: new PIXI.Rectangle(c * FRAME, r * FRAME, FRAME, FRAME),
      }));
    }
    rows.push(cols);
  }
  return rows;
}

// If the vendored sheet ever fails to load, still show *something* (a plain white
// body) so an avatar appears — the ring + nameplate keep working. Keeps the hot
// path in createAvatar/update branch-free (TEX is always populated).
function makeFallbackTexture() {
  const cv = document.createElement('canvas');
  cv.width = FRAME; cv.height = FRAME;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2ede0';
  g.beginPath(); g.roundRect(8, 6, 16, 24, 6); g.fill();
  return PIXI.Texture.from(cv);
}

export async function loadSprites(base = 'sprites/') {
  try {
    const [idle, walk] = await Promise.all([
      PIXI.Assets.load(base + 'char-idle.png'),
      PIXI.Assets.load(base + 'char-walk.png'),
    ]);
    idle.source.scaleMode = 'nearest';
    walk.source.scaleMode = 'nearest';
    TEX = { idle: sliceSheet(idle), walk: sliceSheet(walk) };
  } catch (e) {
    console.error('[arena] sprite sheets failed to load — using fallback body', e);
    const fb = makeFallbackTexture();
    const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => fb));
    TEX = { idle: grid, walk: grid };
  }
}

function tintOf(colour) {
  try { return new PIXI.Color(colour).toNumber(); } catch { return new PIXI.Color('aqua').toNumber(); }
}
function readableInk(num) {
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? 0x0a0f22 : 0xffffff;
}

export function createAvatar(p, opts = {}) {
  const H = FRAME * SPRITE_SCALE; // 96
  const c = new PIXI.Container();

  let colourNum = tintOf(p.colour);
  let facing = { row: 0, flip: false };
  let elapsed = 0;

  const ring = new PIXI.Graphics();
  const you = new PIXI.Graphics(); you.visible = false;
  const sprite = new PIXI.Sprite(TEX.idle[0][0]);
  sprite.anchor.set(0.5, 1);
  sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE);
  const plate = new PIXI.Graphics();
  const label = new PIXI.Text({ text: p.nama || 'tanpa-nama', style: { fill: 0xffffff, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' } });
  label.anchor.set(0.5, 0.5);
  const score = new PIXI.Text({ text: String(p.score ?? 0), style: { fill: 0xbfe3ff, fontSize: 12, fontFamily: 'monospace', stroke: { color: 0x0b1020, width: 3 } } });
  score.anchor.set(0.5, 1);

  c.addChild(ring, you, sprite, plate, label, score);

  function drawRing() {
    const rw = H * 0.28, rh = rw * 0.42;
    ring.clear().ellipse(0, -2, rw, rh).fill({ color: colourNum, alpha: 0.28 }).stroke({ color: colourNum, width: 3 });
    you.clear().ellipse(0, -2, rw + 6, rh + 4).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
  }
  function drawPlate() {
    const padX = 8, h = 20, y = -H - 12;
    const w = label.width + padX * 2;
    plate.clear().roundRect(-w / 2, y - h, w, h, 6).fill({ color: colourNum, alpha: 0.95 });
    label.position.set(0, y - h / 2);
    label.style.fill = readableInk(colourNum);
    score.position.set(0, y - h - 4);
  }
  drawRing(); drawPlate();

  return {
    c,
    target: { x: p.x, y: p.y },
    setColour(col) { const n = tintOf(col); if (n !== colourNum) { colourNum = n; drawRing(); drawPlate(); } },
    setName(n) { const t = n || 'tanpa-nama'; if (label.text !== t) { label.text = t; drawPlate(); } },
    setScore(s) { const t = String(s ?? 0); if (score.text !== t) score.text = t; },
    setYou(yes) { you.visible = !!yes; },
    update(deltaMS) {
      const dx = this.target.x - c.x, dy = this.target.y - c.y;
      const moving = isMoving(dx, dy);
      facing = facingFromVelocity(dx, dy, facing);
      elapsed += deltaMS;
      const fr = frameAt(elapsed, moving ? WALK_FPS : IDLE_FPS);
      sprite.texture = (moving ? TEX.walk : TEX.idle)[facing.row][fr];
      sprite.scale.x = facing.flip ? -SPRITE_SCALE : SPRITE_SCALE;
      c.x += dx * 0.25; c.y += dy * 0.25;
      c.zIndex = c.y; // depth sort: lower on screen = in front
    },
  };
}

export function drawBackground(world) {
  const g = new PIXI.Graphics();
  g.rect(0, 0, WORLD_W, WORLD_H).fill(0x0a0f22);
  for (let x = 0; x <= WORLD_W; x += 80) g.moveTo(x, 0).lineTo(x, WORLD_H);
  for (let y = 0; y <= WORLD_H; y += 80) g.moveTo(0, y).lineTo(WORLD_W, y);
  g.stroke({ color: 0x16224a, width: 1, alpha: 0.5 });
  g.roundRect(8, 8, WORLD_W - 16, WORLD_H - 16, 24).stroke({ color: 0x2a3d78, width: 3, alpha: 0.6 });
  world.addChild(g);
  const glow = new PIXI.Graphics().ellipse(WORLD_W / 2, WORLD_H * 0.44, WORLD_W * 0.42, WORLD_H * 0.42).fill({ color: 0x28407a, alpha: 0.16 });
  world.addChildAt(glow, 1);
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `cd avatar && node --check public/arena-avatar.js`
Expected: no output (syntax OK). (References to global `PIXI` are not resolved by `--check`, which is fine — it's a browser global.)

- [ ] **Step 3: Copy to the server public (identical)**

```bash
cp avatar/public/arena-avatar.js server/public/arena-avatar.js
diff avatar/public/arena-avatar.js server/public/arena-avatar.js && echo IDENTICAL
cd server && node --check public/arena-avatar.js && echo OK
```
Expected: `IDENTICAL` then `OK`.

- [ ] **Step 4: Commit**

```bash
git add avatar/public/arena-avatar.js server/public/arena-avatar.js
git commit -m "feat(render): shared sprite-avatar factory + polished room background"
```

---

### Task 5: Wire the avatar (student) view

**Files:**
- Modify: `avatar/public/avatar.js` (full rewrite)
- Modify: `avatar/public/index.html:21` (script → module)

**Interfaces:**
- Consumes: `loadSprites`, `createAvatar`, `drawBackground` from `./arena-avatar.js`.
- Produces: an ES-module client that renders avatars via the factory, ticks `av.update(deltaMS)`, and sends 8-way `{t:'move',dir}` from a held-key set on a `60 ms` interval.

- [ ] **Step 1: Rewrite `avatar/public/avatar.js`**

Replace the entire file with:

```js
import { loadSprites, createAvatar, drawBackground } from './arena-avatar.js';

const WORLD_W = 1600, WORLD_H = 1000;
const SEND_MS = 60;
window.__arena = { you: null, players: [], room: false };

const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const DIRNAME = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right', '-1,-1': 'upleft', '1,-1': 'upright', '-1,1': 'downleft', '1,1': 'downright' };

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
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let s = sprites.get(p.id);
      if (!s) { s = createAvatar(p); layer.addChild(s.c); s.c.position.set(p.x, p.y); sprites.set(p.id, s); }
      s.target = { x: p.x, y: p.y };
      s.setColour(p.colour); s.setName(p.nama); s.setScore(p.score);
      s.setYou(p.id === myId);
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.delete(id); }
  }

  app.ticker.add((ticker) => { for (const s of sprites.values()) s.update(ticker.deltaMS); });

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

  // held-key 8-way input: track pressed keys, send the resultant direction on a tick
  const held = new Set();
  window.addEventListener('keydown', (e) => { const d = KEYMAP[e.key]; if (!d) return; e.preventDefault(); held.add(d); });
  window.addEventListener('keyup', (e) => { const d = KEYMAP[e.key]; if (!d) return; e.preventDefault(); held.delete(d); });
  function currentDir() {
    const ax = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const ay = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    return DIRNAME[`${ax},${ay}`];
  }
  setInterval(() => {
    const dir = currentDir();
    if (dir && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'move', dir }));
  }, SEND_MS);

  function setBanner(connected) {
    const b = document.getElementById('banner');
    if (connected) b.classList.add('hidden');
    else { b.classList.remove('hidden'); b.textContent = "You're set up — waiting for the room…"; }
  }
})();
```

- [ ] **Step 2: Make the client script a module**

In `avatar/public/index.html`, change line 21 from:

```html
  <script src="avatar.js"></script>
```
to:
```html
  <script type="module" src="avatar.js"></script>
```
(Leave the `vendor/pixi.min.js` classic script tag on the line above unchanged, and do not touch `#stage`, `#banner`, `#hint`, or `<title>`.)

- [ ] **Step 3: Syntax-check**

Run: `cd avatar && node --check public/avatar.js`
Expected: no output (OK).

- [ ] **Step 4: Commit**

```bash
git add avatar/public/avatar.js avatar/public/index.html
git commit -m "feat(avatar-view): render sprites via factory + 8-way held-key input"
```

---

### Task 6: Wire the spectator (projector) view

**Files:**
- Modify: `server/public/spectator.js` (full rewrite)
- Modify: `server/public/index.html:19` (script → module)

**Interfaces:**
- Consumes: `loadSprites`, `createAvatar`, `drawBackground` from `./arena-avatar.js`.
- Produces: an ES-module projector client rendering avatars via the factory (no input); keeps the `#count` readout.

- [ ] **Step 1: Rewrite `server/public/spectator.js`**

Replace the entire file with:

```js
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
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let s = sprites.get(p.id);
      if (!s) { s = createAvatar(p); layer.addChild(s.c); s.c.position.set(p.x, p.y); sprites.set(p.id, s); }
      s.target = { x: p.x, y: p.y };
      s.setColour(p.colour); s.setName(p.nama); s.setScore(p.score);
    }
    for (const [id, s] of sprites) if (!seen.has(id)) { s.c.destroy({ children: true }); sprites.delete(id); }
    document.getElementById('count').textContent = `${players.length} in the room`;
  }

  app.ticker.add((ticker) => { for (const s of sprites.values()) s.update(ticker.deltaMS); });

  connect();
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { window.__arena.connected = true; ws.send(JSON.stringify({ t: 'hello', role: 'spectator' })); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'roster' && Array.isArray(m.players)) { window.__arena.players = m.players; sync(m.players); } };
    ws.onclose = () => { window.__arena.connected = false; setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
  }
})();
```

- [ ] **Step 2: Make the client script a module**

In `server/public/index.html`, change line 19 from:

```html
  <script src="spectator.js"></script>
```
to:
```html
  <script type="module" src="spectator.js"></script>
```
(Leave `vendor/pixi.min.js` above it unchanged; do not touch `#stage`, `#count`, or `<title>`.)

- [ ] **Step 3: Syntax-check**

Run: `cd server && node --check public/spectator.js`
Expected: no output (OK).

- [ ] **Step 4: Commit**

```bash
git add server/public/spectator.js server/public/index.html
git commit -m "feat(spectator-view): render sprites via shared factory"
```

---

### Task 7: Full verification & finalize

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run every unit suite**

```bash
cd /home/debian/repo/devops-bootcamp-game
( cd avatar && node --test ) && ( cd server && node --test )
```
Expected: all tests PASS in both packages (pre-existing + new `anim.test.js` + extended `movement.test.js`).

- [ ] **Step 2: Run the Docker end-to-end proof**

Run: `bash scripts/e2e.sh`
Expected: the script prints its OK markers and exits `0` — volume survival, loud-fail without `--network arena`, graceful degrade (`:8080` still serves `<title>Arena`), and the two-player room. Requires Docker.

- [ ] **Step 3: Visual confirmation (orchestrator)**

Build + run the avatar and server images (or `node src/index.js` with a local `redis`), open the projector (`:3000/`) and student (`:8080/`) views, and confirm: sprites render crisp; ring + nameplate show the player colour/name; walking animates; facing tracks all 8 directions (hold two keys); `docker rm -f profile` then re-run keeps the name. Capture a screenshot of each view.

> This step is run by the orchestrator (needs a browser/screenshot); subagents stop after Step 2 and report.

- [ ] **Step 4: Final commit (if any polish tweaks were made during Step 3)**

```bash
git add -A
git commit -m "chore(arena): visual polish pass after end-to-end verification" || echo "nothing to commit"
```

---

## Notes for the implementer

- **PixiJS v8 specifics:** `PIXI.Assets.load(url)` returns a `Texture`; set `tex.source.scaleMode = 'nearest'` for crisp pixels. Sub-frames: `new PIXI.Texture({ source, frame: new PIXI.Rectangle(x,y,w,h) })`. Ticker callback receives a `Ticker`; use `ticker.deltaMS`. `Graphics` is chained: `.rect().fill()`, `.roundRect().stroke()`, `.ellipse().fill().stroke()`.
- **Why the duplicated files:** each image builds from its own subdirectory context (`docker build ./avatar`, `./server`), so shared JS/PNG must be copied into each `public/`, mirroring the existing vendored `pixi.min.js`. Keep the two copies byte-identical.
- **Scoring is unchanged:** the browser only *throttles* how often it sends `{t:'move',dir}`; the server still does `+1` per message, so `e2e.sh` (5 messages → score 5) is unaffected.
