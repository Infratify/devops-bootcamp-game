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

// --- Snapshot interpolation (fix for the network-driven stutter) ---
// The server is authoritative and sends discrete position snapshots. Rendering the
// latest one directly (or exponentially smoothing toward it, frame-rate-dependently)
// makes motion pulse/judder. Instead we buffer recent {t,x,y} snapshots and render a
// fixed delay behind the newest, LINEARLY interpolating between the two that bracket
// the render time → constant velocity, refresh-rate-independent.
//
// Returns { x, y, vx, vy } where vx/vy is the active segment's velocity in px/sec
// (0 when clamped to an end: before the first sample, or once we've caught up to the
// last one — which is exactly how a stopped/stalled avatar reads as idle). null when
// the buffer is empty (caller keeps the current position).
export function sampleBuffer(buf, renderTime) {
  if (!buf || buf.length === 0) return null;
  const first = buf[0], last = buf[buf.length - 1];
  if (buf.length === 1 || renderTime <= first.t) return { x: first.x, y: first.y, vx: 0, vy: 0 };
  if (renderTime >= last.t) return { x: last.x, y: last.y, vx: 0, vy: 0 };
  let i = 0;
  while (i < buf.length - 1 && buf[i + 1].t <= renderTime) i++;
  const a = buf[i], b = buf[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return { x: b.x, y: b.y, vx: 0, vy: 0 };
  const f = (renderTime - a.t) / span;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    vx: ((b.x - a.x) / span) * 1000,
    vy: ((b.y - a.y) / span) * 1000,
  };
}

// Gait speed for choosing the sheet (idle / walk / run). Do NOT use the raw
// per-segment velocity: snapshot interpolation reconstructs position from a server
// signal that steps at one rate (~60ms) but is sampled at another (~50ms), so ~1
// segment in 6 spans two equal snapshots and reads velocity 0 for ~50ms. Selecting
// the sheet off that raw speed flashes a steady walk to idle for a few frames — the
// "animation resets every couple of steps" glitch. Instead measure displacement of
// the *interpolated* position over a fixed window: that averages out the zero-gaps
// and equals the true speed, with no per-frame state to keep. Pure + unit-tested.
export function bufferSpeed(buf, renderTime, windowMs) {
  const a = sampleBuffer(buf, renderTime - windowMs);
  const b = sampleBuffer(buf, renderTime);
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) / windowMs * 1000;
}

// idle / walk / run from a (smooth) speed, with a touch of hysteresis on the run
// boundary so it can't flap. prev = { running }. Thresholds come in via cfg.
export function nextGait(prev, speed, cfg) {
  const moving = speed > cfg.move;
  const running = moving && speed > (prev.running ? cfg.run * cfg.runExit : cfg.run);
  return { running, moving, loco: !moving ? 'idle' : running ? 'run' : 'walk' };
}

// Jump height cue: normalized 0..1 progress → 0→1→0 arc (parabola, peak 1 at .5),
// layered on the jump *sheet* so the body visibly leaves the ground. Pure + tested.
export const arc01 = (p) => { const t = p < 0 ? 0 : p > 1 ? 1 : p; return 4 * t * (1 - t); };

// Frame index for a one-shot (non-looping) action: clamps at the last frame so the
// caller can detect completion (index >= nFrames) instead of wrapping like frameAt.
export function actionFrame(elapsedMs, fps) {
  return Math.floor((elapsedMs * fps) / 1000);
}

// Edge-triggered one-shot action from a roster's {act, actSeq}. The roster carries the
// acting player's latest action name plus a counter the sender bumps once per action;
// a viewer plays the animation each time the counter CHANGES. `lastSeq` is the caller's
// remembered counter — SEED it from whatever counter is on the entry when the avatar
// first appears (null when the entry has none, which is the normal case): a stale action
// already sitting on a late-joined avatar then shares that seed and is NOT replayed,
// while the first *fresh* action arrives as a change from the seed and DOES play. (The
// old "first non-null seq seen sets the baseline" rule wrongly swallowed that first
// fresh action for every remote viewer, so actions only replicated from the 2nd on.)
// Returns { seq, play } — `seq` is the counter to remember, `play` the action name to
// start now (null = nothing new to play). Unknown names advance the counter but play
// nothing, so a later real action isn't mis-compared against them.
export function nextAction(lastSeq, act, actSeq, known) {
  if (actSeq == null || actSeq === lastSeq) return { seq: lastSeq, play: null };
  return { seq: actSeq, play: (act && known && known[act]) ? act : null };
}
