export function parse(raw) {
  try { const m = JSON.parse(raw); return (m && typeof m === 'object') ? m : null; }
  catch { return null; }
}
export const youMsg = (s) => JSON.stringify({ t: 'you', ...s });
export const rosterMsg = (players) => JSON.stringify({ t: 'roster', players });
export const roomMsg = (connected) => JSON.stringify({ t: 'room', connected });
export const joinMsg = (c) => JSON.stringify({ t: 'join', ...c });
export const updateMsg = (u) => JSON.stringify({ t: 'update', ...u });
export const isMove = (m) => !!m && m.t === 'move' && typeof m.dir === 'string';
