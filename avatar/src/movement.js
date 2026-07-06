import { WORLD_W, WORLD_H, STEP, AVATAR_R } from './constants.js';

const D = Math.round(STEP * Math.SQRT1_2); // diagonal per-axis step (normalized so diag ≈ STEP)
const DIRS = {
  up: [0, -STEP], down: [0, STEP], left: [-STEP, 0], right: [STEP, 0],
  upleft: [-D, -D], upright: [D, -D], downleft: [-D, D], downright: [D, D],
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function isDir(d) { return Object.prototype.hasOwnProperty.call(DIRS, d); }

export function move(pos, dir) {
  if (!isDir(dir)) return { x: pos.x, y: pos.y };
  const v = DIRS[dir];
  return {
    x: clamp(pos.x + v[0], AVATAR_R, WORLD_W - AVATAR_R),
    y: clamp(pos.y + v[1], AVATAR_R, WORLD_H - AVATAR_R),
  };
}
