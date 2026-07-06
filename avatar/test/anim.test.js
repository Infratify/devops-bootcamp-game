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
