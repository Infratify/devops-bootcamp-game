import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startAvatar } from '../src/app.js';

function fakeStore(initial = {}) {
  const data = { ...initial };
  const calls = { save: 0 };
  return { data, calls,
    async get(k) { return k in data ? data[k] : null; },
    async set(k, v) { data[k] = v; },
    async save() { calls.save++; },
    async quit() {} };
}
// fake room that captures updates and never "connects"
function fakeRoomFactory(sink) {
  return (addr, handlers) => { sink.handlers = handlers; sink.updates = []; return { sendUpdate: (u) => sink.updates.push(u), close() {} }; };
}
// Buffers every message from socket creation so a frame the server sends
// synchronously on 'connection' (ahead of the client's 'open' handler running)
// is never missed by a predicate registered after the fact.
function collectMessages(ws) {
  const buf = [];
  const waiters = [];
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    const idx = waiters.findIndex((w) => !w.pred || w.pred(m));
    if (idx >= 0) { const [w] = waiters.splice(idx, 1); clearTimeout(w.timer); w.resolve(m); }
    else buf.push(m);
  });
  return function nextMsg(pred) {
    const idx = buf.findIndex((m) => !pred || pred(m));
    if (idx >= 0) return Promise.resolve(buf.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error('timeout'));
      }, 2000);
      waiters.push({ pred, resolve, timer });
    });
  };
}

test('serves browser, moves, increments score, persists, forwards to room', async () => {
  const store = fakeStore({ nama: 'Ariff' });
  const sink = {};
  const app = await startAvatar({ env: { COLOR: 'cyan', SERVER: '' }, storeFactory: async () => store, roomFactory: fakeRoomFactory(sink), port: 0 });
  try {
    assert.ok(store.calls.save >= 1, 'startup SAVE issued');           // startup save
    const ws = new WebSocket(`ws://localhost:${app.port}`);
    const nextMsg = collectMessages(ws);
    await new Promise((r) => ws.on('open', r));
    const you = await nextMsg((m) => m.t === 'you');
    assert.equal(you.nama, 'Ariff');
    assert.equal(you.colour, 'cyan');
    assert.equal(you.room, false);
    ws.send(JSON.stringify({ t: 'move', dir: 'right' }));
    const roster = await nextMsg((m) => m.t === 'roster' && m.players[0].score === 1);
    assert.equal(roster.players[0].score, 1);
    assert.equal(sink.updates.at(-1).score, 1);
    ws.close();
  } finally {
    await app.close();
  }
});

test('NAME becomes the save-file key; seeds the save and wins the nameplate (no SLOT needed)', async () => {
  const store = fakeStore();
  const captured = {};
  const sink = {};
  const app = await startAvatar({
    env: { COLOR: 'red', SERVER: '', NAME: 'Dua' },
    storeFactory: async (host, prefix) => { captured.host = host; captured.prefix = prefix; return store; },
    roomFactory: fakeRoomFactory(sink), port: 0,
  });
  try {
    assert.equal(captured.host, 'profile', 'default remember-box host');
    assert.equal(captured.prefix, 'Dua:', 'NAME becomes the key prefix — your name is your save file');
    assert.equal(store.data.nama, 'Dua', 'NAME written through to the save');
    const ws = new WebSocket(`ws://localhost:${app.port}`);
    const nextMsg = collectMessages(ws);
    await new Promise((r) => ws.on('open', r));
    const you = await nextMsg((m) => m.t === 'you');
    assert.equal(you.nama, 'Dua');
    ws.close();
  } finally {
    await app.close();
  }
});

test('SLOT overrides NAME as the key prefix (explicit save-slot for same-name avatars)', async () => {
  const store = fakeStore();
  const captured = {};
  const sink = {};
  const app = await startAvatar({
    env: { COLOR: 'red', SERVER: '', SLOT: '2', NAME: 'Dua' },
    storeFactory: async (host, prefix) => { captured.prefix = prefix; return store; },
    roomFactory: fakeRoomFactory(sink), port: 0,
  });
  try {
    assert.equal(captured.prefix, '2:', 'SLOT wins over NAME when both are set');
    assert.equal(store.data.nama, 'Dua', 'NAME still written through to the save');
    await app.close();
  } catch (e) { await app.close(); throw e; }
});

test('no SLOT/NAME → bare keys and the stored nama (unchanged Docker 3 flow)', async () => {
  const store = fakeStore({ nama: 'Ariff' });
  const captured = {};
  const sink = {};
  const app = await startAvatar({
    env: { COLOR: 'cyan', SERVER: '' },
    storeFactory: async (host, prefix) => { captured.prefix = prefix; return store; },
    roomFactory: fakeRoomFactory(sink), port: 0,
  });
  try {
    assert.equal(captured.prefix, '', 'unset SLOT = bare keys');
    assert.equal(store.data.nama, 'Ariff', 'stored nama untouched');
    const ws = new WebSocket(`ws://localhost:${app.port}`);
    const nextMsg = collectMessages(ws);
    await new Promise((r) => ws.on('open', r));
    const you = await nextMsg((m) => m.t === 'you');
    assert.equal(you.nama, 'Ariff');
    ws.close();
  } finally {
    await app.close();
  }
});

test('re-sends you with the server-assigned id on welcome (fixes stale you-ring)', async () => {
  const store = fakeStore({ nama: 'Ariff' });
  const sink = {};
  const app = await startAvatar({ env: { COLOR: 'cyan', SERVER: '' }, storeFactory: async () => store, roomFactory: fakeRoomFactory(sink), port: 0 });
  try {
    const ws = new WebSocket(`ws://localhost:${app.port}`);
    const nextMsg = collectMessages(ws);
    await new Promise((r) => ws.on('open', r));
    const firstYou = await nextMsg((m) => m.t === 'you');
    assert.ok(firstYou.id.startsWith('a'), 'initial id is the locally-generated rid()');

    sink.handlers.onWelcome('p9');

    const secondYou = await nextMsg((m) => m.t === 'you');
    assert.equal(secondYou.id, 'p9', 'browser gets a fresh you with the server-assigned id');
    assert.notEqual(secondYou.id, firstYou.id);
    ws.close();
  } finally {
    await app.close();
  }
});
