import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, sanitizeJoin, sanitizeUpdate } from '../src/room.js';
import { WORLD_W, WORLD_H } from '../src/constants.js';

test('sanitizeJoin fills defaults and clamps', () => {
  const e = sanitizeJoin({ nama: '  Ariff  ', colour: 'cyan', x: 99999, y: -50, score: 7 });
  assert.equal(e.nama, 'Ariff');
  assert.equal(e.colour, 'cyan');
  assert.equal(e.x, WORLD_W);
  assert.equal(e.y, 0);
  assert.equal(e.score, 7);
});

test('sanitizeJoin defends against junk', () => {
  const e = sanitizeJoin({ nama: 'x'.repeat(50) + '\x00', colour: 123, x: 'NaN', score: -3 });
  assert.equal(e.nama.length, 24);
  assert.equal(e.colour, 'aqua');
  assert.equal(e.x, WORLD_W / 2);
  assert.equal(e.score, 0);
});

test('sanitizeJoin empty nama → placeholder', () => {
  assert.equal(sanitizeJoin({ nama: '   ' }).nama, 'tanpa-nama');
});

test('sanitizeUpdate keeps only valid present fields', () => {
  assert.deepEqual(sanitizeUpdate({ x: 10, score: 4, junk: 1 }), { x: 10, score: 4 });
  assert.deepEqual(sanitizeUpdate({ y: 'bad' }), {});
});

test('Room join/update/leave/roster lifecycle', () => {
  const r = new Room();
  const id = r.nextId();
  r.join(id, { nama: 'Ariff', colour: 'cyan', x: 100, y: 100, score: 0 });
  assert.equal(r.roster().length, 1);
  r.update(id, { x: 112, score: 1 });
  const p = r.roster()[0];
  assert.equal(p.id, id);
  assert.equal(p.x, 112);
  assert.equal(p.score, 1);
  assert.equal(r.update('missing', { x: 1 }), null);
  assert.equal(r.leave(id), true);
  assert.equal(r.roster().length, 0);
});
