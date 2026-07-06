import { WORLD_W, WORLD_H } from './constants.js';

const cleanStr = (s, max) =>
  (typeof s === 'string' ? s.replace(/[\u0000-\u001F]/g, '').trim().slice(0, max) : '');

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};

const clampScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
};

export function sanitizeJoin(info = {}) {
  return {
    nama: cleanStr(info.nama, 24) || 'tanpa-nama',
    colour: cleanStr(info.colour, 32) || 'aqua',
    x: clampNum(info.x, 0, WORLD_W, WORLD_W / 2),
    y: clampNum(info.y, 0, WORLD_H, WORLD_H / 2),
    score: clampScore(info.score),
  };
}

export function sanitizeUpdate(patch = {}) {
  const out = {};
  if (patch.x !== undefined) { const n = clampNum(patch.x, 0, WORLD_W, undefined); if (n !== undefined) out.x = n; }
  if (patch.y !== undefined) { const n = clampNum(patch.y, 0, WORLD_H, undefined); if (n !== undefined) out.y = n; }
  if (patch.score !== undefined) out.score = clampScore(patch.score);
  return out;
}

export class Room {
  constructor() { this.players = new Map(); this._seq = 0; }
  nextId() { return `p${++this._seq}`; }
  join(id, info) { const e = sanitizeJoin(info); this.players.set(id, e); return e; }
  update(id, patch) { const e = this.players.get(id); if (!e) return null; Object.assign(e, sanitizeUpdate(patch)); return e; }
  leave(id) { return this.players.delete(id); }
  roster() { return [...this.players.entries()].map(([id, e]) => ({ id, ...e })); }
}
