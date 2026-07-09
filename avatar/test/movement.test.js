import { test } from 'node:test';
import assert from 'node:assert/strict';
import { move, isDir } from '../src/movement.js';
import { STEP, RUN_STEP, AVATAR_R, WORLD_W, WORLD_H } from '../src/constants.js';

test('isDir', () => {
  assert.equal(isDir('up'), true);
  assert.equal(isDir('sideways'), false);
});
test('move steps by STEP', () => {
  assert.deepEqual(move({ x: 800, y: 500 }, 'right'), { x: 800 + STEP, y: 500 });
  assert.deepEqual(move({ x: 800, y: 500 }, 'up'), { x: 800, y: 500 - STEP });
});
test('move with RUN_STEP travels farther (Shift-run)', () => {
  assert.deepEqual(move({ x: 800, y: 500 }, 'right', RUN_STEP), { x: 800 + RUN_STEP, y: 500 });
  assert.ok(RUN_STEP > STEP, 'run outpaces walk so clients read it as a run');
  const D = Math.round(RUN_STEP * Math.SQRT1_2);
  assert.deepEqual(move({ x: 800, y: 500 }, 'upright', RUN_STEP), { x: 800 + D, y: 500 - D });
});
test('move clamps to world minus radius', () => {
  assert.deepEqual(move({ x: AVATAR_R, y: 500 }, 'left'), { x: AVATAR_R, y: 500 });
  assert.deepEqual(move({ x: WORLD_W - AVATAR_R, y: WORLD_H - AVATAR_R }, 'down'), { x: WORLD_W - AVATAR_R, y: WORLD_H - AVATAR_R });
});
test('invalid dir returns copy', () => {
  const p = { x: 10, y: 20 };
  const r = move(p, 'nope');
  assert.deepEqual(r, p);
  assert.notEqual(r, p);
});
test('prototype-chain dir names are invalid, return copy', () => {
  const p = { x: 10, y: 20 };
  for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(move(p, bad), { x: 10, y: 20 });
  }
});
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
