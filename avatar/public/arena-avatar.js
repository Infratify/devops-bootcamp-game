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
