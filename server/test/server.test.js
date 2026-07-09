import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer } from '../src/app.js';

const openClient = (port) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.on('open', () => resolve(ws));
});
const nextMsg = (ws, pred) => new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout waiting for message')), 2000);
  const on = (data) => { const m = JSON.parse(data.toString()); if (!pred || pred(m)) { clearTimeout(to); ws.off('message', on); resolve(m); } };
  ws.on('message', on);
});

test('avatar joins, spectator sees roster, disconnect removes, junk is ignored', async () => {
  const app = createServer({ port: 0 });
  const port = app.port;
  try {
    const avatar = await openClient(port);
    avatar.send(JSON.stringify({ t: 'join', nama: 'Ariff', colour: 'cyan', x: 100, y: 100, score: 0 }));
    const welcome = await nextMsg(avatar, (m) => m.t === 'welcome');
    assert.match(welcome.id, /^p\d+$/);

    avatar.send('this is not json');            // must not crash the hub
    avatar.send(JSON.stringify({ t: 'update', x: 150, score: 3 }));

    const spectator = await openClient(port);
    spectator.send(JSON.stringify({ t: 'hello', role: 'spectator' }));
    const roster = await nextMsg(spectator, (m) => m.t === 'roster' && m.players.some((p) => p.nama === 'Ariff'));
    const ariff = roster.players.find((p) => p.nama === 'Ariff');
    assert.equal(ariff.x, 150);
    assert.equal(ariff.score, 3);

    avatar.close();
    const gone = await nextMsg(spectator, (m) => m.t === 'roster' && !m.players.some((p) => p.nama === 'Ariff'));
    assert.equal(gone.players.length, 0);
    spectator.close();
  } finally {
    await app.close();
  }
});

test('a cosmetic action relays through the hub to another viewer (act/actSeq survive the round-trip)', async () => {
  const app = createServer({ port: 0 });
  const port = app.port;
  try {
    // Avatar joins with NO act/actSeq — exactly what getJoinPayload sends. This is the
    // case the first-action-swallow bug lived in: the acting entry carries no counter
    // until the very first action, so the relay must introduce act/actSeq on that update.
    const avatar = await openClient(port);
    avatar.send(JSON.stringify({ t: 'join', nama: 'Ariff', colour: 'cyan', x: 100, y: 100, score: 0 }));
    await nextMsg(avatar, (m) => m.t === 'welcome');

    const viewer = await openClient(port);
    viewer.send(JSON.stringify({ t: 'hello', role: 'spectator' }));
    const before = await nextMsg(viewer, (m) => m.t === 'roster' && m.players.some((p) => p.nama === 'Ariff'));
    assert.equal(before.players.find((p) => p.nama === 'Ariff').actSeq, undefined, 'no counter before any action');

    avatar.send(JSON.stringify({ t: 'update', act: 'jump', actSeq: 1 }));
    const after = await nextMsg(viewer, (m) => m.t === 'roster' && m.players.some((p) => p.act === 'jump'));
    const ariff = after.players.find((p) => p.nama === 'Ariff');
    assert.equal(ariff.act, 'jump', 'action name reaches the other viewer');
    assert.equal(ariff.actSeq, 1, 'edge counter reaches the other viewer');

    avatar.close(); viewer.close();
  } finally {
    await app.close();
  }
});
