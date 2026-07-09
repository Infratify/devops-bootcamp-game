import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facingFromVelocity, isMoving, frameAt, sampleBuffer, bufferSpeed, arc01, actionFrame, nextGait } from '../public/arena-anim.js';

const GAIT = { move: 20, run: 275, runExit: 0.9 };

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

test('frameAt honours a custom frame count (run = 6 frames)', () => {
  assert.equal(frameAt(0, 12, 6), 0);
  assert.equal(frameAt(1000, 12, 6), 0);   // 12 % 6
  assert.equal(frameAt(1000 * 5 / 12, 12, 6), 5);
});

test('sampleBuffer: empty → null, single → held with no velocity', () => {
  assert.equal(sampleBuffer([], 100), null);
  assert.equal(sampleBuffer(null, 100), null);
  assert.deepEqual(sampleBuffer([{ t: 100, x: 5, y: 6 }], 999), { x: 5, y: 6, vx: 0, vy: 0 });
});

test('sampleBuffer: linear interpolation + segment velocity in px/s', () => {
  const buf = [{ t: 100, x: 0, y: 0 }, { t: 200, x: 100, y: 50 }];
  assert.deepEqual(sampleBuffer(buf, 150), { x: 50, y: 25, vx: 1000, vy: 500 });
  assert.deepEqual(sampleBuffer(buf, 175), { x: 75, y: 37.5, vx: 1000, vy: 500 });
});

test('sampleBuffer: clamps before first / after last with zero velocity (→ idle)', () => {
  const buf = [{ t: 100, x: 0, y: 0 }, { t: 200, x: 100, y: 50 }];
  assert.deepEqual(sampleBuffer(buf, 40), { x: 0, y: 0, vx: 0, vy: 0 });   // before first
  assert.deepEqual(sampleBuffer(buf, 260), { x: 100, y: 50, vx: 0, vy: 0 }); // after last = stalled/stopped
});

test('sampleBuffer: picks the correct bracketing segment among many', () => {
  const buf = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 10, y: 0 }, { t: 200, x: 30, y: 0 }];
  assert.deepEqual(sampleBuffer(buf, 150), { x: 20, y: 0, vx: 200, vy: 0 }); // 2nd segment: 20px/100ms
});

test('arc01 is a 0→1→0 hop, clamped outside [0,1]', () => {
  assert.equal(arc01(0), 0);
  assert.equal(arc01(0.5), 1);
  assert.equal(arc01(1), 0);
  assert.equal(arc01(-3), 0);
  assert.equal(arc01(5), 0);
});

test('actionFrame advances and runs past the last frame so completion is detectable', () => {
  assert.equal(actionFrame(0, 12), 0);
  assert.equal(actionFrame(100, 12), 1);    // floor(1.2)
  assert.equal(actionFrame(500, 12), 6);    // ≥ 5 → a 5-frame jump is done
});

test('bufferSpeed: constant-velocity buffer measures the true speed', () => {
  const buf = [{ t: 0, x: 0, y: 0 }, { t: 60, x: 12, y: 0 }, { t: 120, x: 24, y: 0 }, { t: 180, x: 36, y: 0 }, { t: 240, x: 48, y: 0 }];
  assert.equal(Math.round(bufferSpeed(buf, 240, 120)), 200); // 12px / 60ms = 200px/s
});

test('bufferSpeed: a window spanning an internal zero-gap is NOT dragged to 0 (the fix)', () => {
  // segment [55,110] is an equal pair (12→12): the aliasing zero-gap that used to flash idle
  const buf = [{ t: 0, x: 0, y: 0 }, { t: 55, x: 12, y: 0 }, { t: 110, x: 12, y: 0 }, { t: 165, x: 24, y: 0 }, { t: 220, x: 36, y: 0 }];
  const spd = bufferSpeed(buf, 205, 150);
  assert.ok(spd > 120, `windowed speed ${spd.toFixed(0)} stays well above idle despite the gap`);
});

test('bufferSpeed: empty buffer → 0', () => {
  assert.equal(bufferSpeed([], 100, 150), 0);
});

const g0 = { running: false };

test('nextGait: idle / walk / run by speed', () => {
  assert.equal(nextGait(g0, 0, GAIT).loco, 'idle');
  assert.equal(nextGait(g0, 200, GAIT).loco, 'walk'); // walk ≈ 200px/s
  assert.equal(nextGait(g0, 350, GAIT).loco, 'run');  // run  ≈ 350px/s
});

test('nextGait: run has hysteresis so it will not flap at the boundary', () => {
  const run = { running: true };
  assert.equal(nextGait(run, 260, GAIT).loco, 'run', 'stays run above the lower exit threshold (247)');
  assert.equal(nextGait(run, 240, GAIT).loco, 'walk', 'drops to walk once clearly below');
  assert.equal(nextGait(g0, 260, GAIT).loco, 'walk', 'but needs > run (275) to enter run from walk');
});
