import { test } from 'node:test';
import assert from 'node:assert/strict';
import { move, isDir } from '../src/movement.js';
import { STEP, AVATAR_R, WORLD_W, WORLD_H } from '../src/constants.js';

test('isDir', () => {
  assert.equal(isDir('up'), true);
  assert.equal(isDir('sideways'), false);
});
test('move steps by STEP', () => {
  assert.deepEqual(move({ x: 800, y: 500 }, 'right'), { x: 800 + STEP, y: 500 });
  assert.deepEqual(move({ x: 800, y: 500 }, 'up'), { x: 800, y: 500 - STEP });
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
