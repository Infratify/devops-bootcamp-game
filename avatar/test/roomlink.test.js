import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createRoomLink } from '../src/roomlink.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('empty SERVER → local-only, onStatus(false), no crash', async () => {
  let status = null;
  const link = createRoomLink('', { getJoinPayload: () => ({}), onStatus: (c) => { status = c; } });
  await wait(50);
  assert.equal(status, false);
  assert.equal(link.connected, false);
  link.close();
});

test('connects, joins, receives welcome+roster, reconnects after drop', async () => {
  const events = { welcome: null, roster: null, statuses: [] };
  let joined = null;
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  wss.on('connection', (ws) => {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'join') { joined = m; ws.send(JSON.stringify({ t: 'welcome', id: 'p9' })); ws.send(JSON.stringify({ t: 'roster', players: [{ id: 'p9', nama: 'A' }] })); }
    });
  });

  const link = createRoomLink(`localhost:${port}`, {
    getJoinPayload: () => ({ nama: 'A', colour: 'cyan', x: 1, y: 2, score: 0 }),
    onWelcome: (id) => { events.welcome = id; },
    onRoster: (p) => { events.roster = p; },
    onStatus: (c) => { events.statuses.push(c); },
  });

  await wait(150);
  assert.equal(joined.nama, 'A');
  assert.equal(events.welcome, 'p9');
  assert.deepEqual(events.roster, [{ id: 'p9', nama: 'A' }]);
  assert.ok(events.statuses.includes(true));

  // drop all sockets → link should see close then reconnect
  for (const c of wss.clients) c.terminate();
  await wait(50);
  assert.equal(events.statuses.at(-1), false);
  await wait(800);                       // backoff reconnect
  assert.equal(events.statuses.at(-1), true);

  link.close();
  await new Promise((r) => wss.close(r));
});
