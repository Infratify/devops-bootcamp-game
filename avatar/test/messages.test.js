import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, youMsg, rosterMsg, roomMsg, joinMsg, updateMsg, isMove } from '../src/messages.js';

test('parse', () => {
  assert.deepEqual(parse('{"t":"move","dir":"up"}'), { t: 'move', dir: 'up' });
  assert.equal(parse('nope'), null);
});
test('isMove', () => {
  assert.equal(isMove({ t: 'move', dir: 'left' }), true);
  assert.equal(isMove({ t: 'move' }), false);
  assert.equal(isMove(null), false);
});
test('builders round-trip', () => {
  assert.deepEqual(JSON.parse(youMsg({ id: 'local', nama: 'A', colour: 'cyan', x: 1, y: 2, score: 0, room: false })),
    { t: 'you', id: 'local', nama: 'A', colour: 'cyan', x: 1, y: 2, score: 0, room: false });
  assert.deepEqual(JSON.parse(rosterMsg([{ id: 'p1' }])), { t: 'roster', players: [{ id: 'p1' }] });
  assert.deepEqual(JSON.parse(roomMsg(true)), { t: 'room', connected: true });
  assert.deepEqual(JSON.parse(joinMsg({ nama: 'A', colour: 'c', x: 1, y: 2, score: 3 })), { t: 'join', nama: 'A', colour: 'c', x: 1, y: 2, score: 3 });
  assert.deepEqual(JSON.parse(updateMsg({ x: 1, y: 2, score: 3 })), { t: 'update', x: 1, y: 2, score: 3 });
});
