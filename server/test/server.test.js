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
