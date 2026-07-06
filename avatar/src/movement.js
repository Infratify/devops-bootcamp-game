import { WORLD_W, WORLD_H, STEP, AVATAR_R } from './constants.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function isDir(d) { return Object.prototype.hasOwnProperty.call(DIRS, d); }

export function move(pos, dir) {
  const v = DIRS[dir];
  if (!v) return { x: pos.x, y: pos.y };
  return {
    x: clamp(pos.x + v[0] * STEP, AVATAR_R, WORLD_W - AVATAR_R),
    y: clamp(pos.y + v[1] * STEP, AVATAR_R, WORLD_H - AVATAR_R),
  };
}
