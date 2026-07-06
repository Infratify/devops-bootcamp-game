import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOrInit, resolveColour, DEFAULT_COLOUR } from '../src/character.js';
import { WORLD_W, WORLD_H, AVATAR_R } from '../src/constants.js';

function fakeStore(initial = {}) {
  const data = { ...initial };
  const calls = { set: [], save: 0 };
  return {
    data, calls,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v) { data[k] = v; calls.set.push([k, v]); },
    async save() { calls.save++; },
  };
}

test('resolveColour precedence', () => {
  assert.equal(resolveColour('cyan', 'red'), 'cyan');
  assert.equal(resolveColour('', 'red'), 'red');
  assert.equal(resolveColour('  ', ''), DEFAULT_COLOUR);
});

test('loadOrInit on empty store: defaults, saves, never writes nama', async () => {
  const s = fakeStore();
  const c = await loadOrInit(s, { colour: 'cyan' });
  assert.equal(c.nama, null);
  assert.equal(c.colour, 'cyan');
  assert.equal(c.score, 0);
  assert.ok(c.x >= AVATAR_R && c.x <= WORLD_W - AVATAR_R);
  assert.ok(c.y >= AVATAR_R && c.y <= WORLD_H - AVATAR_R);
  assert.ok(s.calls.set.some(([k]) => k === 'colour'));
  assert.ok(s.calls.set.some(([k]) => k === 'score'));
  assert.ok(!s.calls.set.some(([k]) => k === 'nama'));
  assert.equal(s.calls.save, 1);
});

test('loadOrInit reads existing character; env colour still wins', async () => {
  const s = fakeStore({ nama: 'Ariff', colour: 'red', score: '42', x: '300', y: '400' });
  const c = await loadOrInit(s, { colour: 'cyan' });
  assert.equal(c.nama, 'Ariff');
  assert.equal(c.colour, 'cyan');
  assert.equal(c.score, 42);
  assert.equal(c.x, 300);
  assert.equal(c.y, 400);
});

test('loadOrInit falls back to stored colour when no env', async () => {
  const s = fakeStore({ colour: 'magenta' });
  const c = await loadOrInit(s, {});
  assert.equal(c.colour, 'magenta');
});
