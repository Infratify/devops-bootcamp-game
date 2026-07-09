// Shared avatar renderer. Uses global PIXI (vendor/pixi.min.js) + pure arena-anim.js.
// Byte-identical copy in avatar/public/ and server/public/ (vendored, like pixi.min.js).
import { facingFromVelocity, frameAt, sampleBuffer, bufferSpeed, arc01, actionFrame, nextGait } from './arena-anim.js';

const FRAME = 32, ROWS = 5;
const SPRITE_SCALE = 3;              // 32px art → 96px on screen
const WORLD_W = 1600, WORLD_H = 1000;

// Looping locomotion sheets, chosen by interpolated speed (px/s).
const IDLE_FPS = 4, WALK_FPS = 8, RUN_FPS = 12;
const MOVE_SPEED = 20;               // windowed speed below this = idle
const RUN_SPEED = 275;              // windowed speed above this = run (walk≈200, run≈360 px/s)
const GAIT_WINDOW = 150;             // ms: window over which gait speed is measured (smooths zero-gaps)
const GAIT_CFG = { move: MOVE_SPEED, run: RUN_SPEED, runExit: 0.9 }; // runExit<1 = walk↔run hysteresis

// One-shot action sheets (play once, then fall back to locomotion). fps tuned so each
// reads at a natural pace; the jump also gets a real vertical arc for a height cue.
const ACTIONS = { jump: 12, punch: 16, interact: 10 };
const ACTION_SHEET = { jump: 'jump', punch: 'attack', interact: 'interact' };
const JUMP_H = 42;                   // px the body lifts at the apex

// Snapshot interpolation: render this far behind the newest snapshot and lerp between
// the two that bracket it → constant-velocity, refresh-rate-independent motion. The
// old `c.x += dx*0.25`-per-frame smoother pulsed the velocity and varied with the
// monitor's refresh rate — that was the stutter.
const INTERP_DELAY = 110;            // ms
const SMOOTH_TAU = 80;               // ms low-pass toward the interpolated target (absorbs jitter ripple)
const BUFFER_MAX = 12;

let TEX = null; // { idle, walk, run, jump, attack, interact }: each Texture[row][col]

function sliceSheet(tex) {
  const cols = Math.max(1, Math.round(tex.source.width / FRAME));
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push(new PIXI.Texture({
        source: tex.source,
        frame: new PIXI.Rectangle(c * FRAME, r * FRAME, FRAME, FRAME),
      }));
    }
    rows.push(row);
  }
  return rows;
}

// If a vendored sheet ever fails to load, still show *something* (a plain white body)
// so an avatar appears — ring + nameplate keep working. Wide enough (7 cols) to index
// any action frame safely, so the hot path in update stays branch-free.
function makeFallbackGrid() {
  const cv = document.createElement('canvas');
  cv.width = FRAME; cv.height = FRAME;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2ede0';
  g.beginPath(); g.roundRect(8, 6, 16, 24, 6); g.fill();
  const fb = PIXI.Texture.from(cv);
  return Array.from({ length: ROWS }, () => Array.from({ length: 7 }, () => fb));
}

export async function loadSprites(base = 'sprites/') {
  const sheets = {
    idle: 'char-idle.png', walk: 'char-walk.png', run: 'char-run.png',
    jump: 'char-jump.png', attack: 'char-attack.png', interact: 'char-interact.png',
  };
  try {
    const names = Object.keys(sheets);
    const loaded = await Promise.all(names.map((n) => PIXI.Assets.load(base + sheets[n])));
    TEX = {};
    names.forEach((n, i) => { loaded[i].source.scaleMode = 'nearest'; TEX[n] = sliceSheet(loaded[i]); });
  } catch (e) {
    console.error('[arena] sprite sheets failed to load — using fallback body', e);
    const grid = makeFallbackGrid();
    TEX = { idle: grid, walk: grid, run: grid, jump: grid, attack: grid, interact: grid };
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
  const buf = [];                    // {t,x,y} snapshots for interpolation
  let gait = { running: false };     // idle/walk/run state (hysteresis on run)
  let action = null;                 // { name, start } while a one-shot plays
  let lastActSeq = null;             // edge-detect roster action triggers

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
    // Feed an authoritative snapshot (from the roster) into the interpolation buffer.
    pushSnapshot(x, y, nowMs) {
      const prev = buf[buf.length - 1];
      if (prev && nowMs - prev.t < 1) { prev.x = x; prev.y = y; return; } // coalesce same-frame
      buf.push({ t: nowMs, x, y });
      if (buf.length > BUFFER_MAX) buf.shift();
    },
    // Edge-triggered one-shot action from the roster's {act, actSeq}. First sight sets
    // the baseline so a stale action isn't replayed when an avatar first appears.
    setAction(act, actSeq) {
      if (actSeq == null) return;
      if (lastActSeq == null) { lastActSeq = actSeq; return; }
      if (actSeq !== lastActSeq) {
        lastActSeq = actSeq;
        if (act && ACTIONS[act]) { action = { name: act, start: elapsed }; }
      }
    },
    setColour(col) { const n = tintOf(col); if (n !== colourNum) { colourNum = n; drawRing(); drawPlate(); } },
    setName(n) { const t = n || 'tanpa-nama'; if (label.text !== t) { label.text = t; drawPlate(); } },
    setScore(s) { const t = String(s ?? 0); if (score.text !== t) score.text = t; },
    setYou(yes) { you.visible = !!yes; },
    update(deltaMS, nowMs) {
      elapsed += deltaMS;

      // Position + velocity from snapshot interpolation (see INTERP_DELAY), then a
      // light frame-rate-independent low-pass toward it to absorb residual jitter
      // ripple (cadence alignment removes the systematic aliasing; this mops up the
      // random part). SMOOTH_TAU≈0 would be pure interpolation.
      const s = sampleBuffer(buf, nowMs - INTERP_DELAY);
      let vx = 0, vy = 0;
      if (s) {
        const k = SMOOTH_TAU > 0 ? 1 - Math.exp(-deltaMS / SMOOTH_TAU) : 1;
        c.x += (s.x - c.x) * k; c.y += (s.y - c.y) * k;
        vx = s.vx; vy = s.vy;
      }
      c.zIndex = c.y; // depth sort: lower on screen = in front

      gait = nextGait(gait, bufferSpeed(buf, nowMs - INTERP_DELAY, GAIT_WINDOW), GAIT_CFG);
      facing = facingFromVelocity(vx, vy, facing);

      let oy = 0, ringScale = 1;
      let tex = null;
      if (action) {
        const sheet = TEX[ACTION_SHEET[action.name]];
        const nFrames = sheet[facing.row].length;
        const af = actionFrame(elapsed - action.start, ACTIONS[action.name]);
        if (af >= nFrames) { action = null; }                    // one-shot done → locomotion
        else {
          tex = sheet[facing.row][af];
          if (action.name === 'jump') {                          // real arc + shadow shrink for height
            const a = arc01((elapsed - action.start) / (nFrames * 1000 / ACTIONS.jump));
            oy = -JUMP_H * a; ringScale = 1 - 0.45 * a;
          }
        }
      }
      if (!tex) {                                                // locomotion: idle / walk / run loop
        const loco = gait.loco;
        const fps = loco === 'idle' ? IDLE_FPS : loco === 'run' ? RUN_FPS : WALK_FPS;
        const rowTex = TEX[loco][facing.row];
        tex = rowTex[frameAt(elapsed, fps, rowTex.length)];
      }

      sprite.texture = tex;
      sprite.scale.x = facing.flip ? -SPRITE_SCALE : SPRITE_SCALE;
      sprite.position.set(0, oy);
      ring.scale.set(ringScale);
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
