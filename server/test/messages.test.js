import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, rosterMsg, welcomeMsg } from '../src/messages.js';

test('parse returns object or null', () => {
  assert.deepEqual(parse('{"t":"x"}'), { t: 'x' });
  assert.equal(parse('not json'), null);
  assert.equal(parse('123'), null);
});
test('builders', () => {
  assert.equal(rosterMsg([]), '{"t":"roster","players":[]}');
  assert.equal(welcomeMsg('p1'), '{"t":"welcome","id":"p1"}');
});
