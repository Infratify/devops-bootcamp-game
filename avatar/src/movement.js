import { WORLD_W, WORLD_H, STEP, AVATAR_R } from './constants.js';

const UNIT = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  upleft: [-Math.SQRT1_2, -Math.SQRT1_2], upright: [Math.SQRT1_2, -Math.SQRT1_2],
  downleft: [-Math.SQRT1_2, Math.SQRT1_2], downright: [Math.SQRT1_2, Math.SQRT1_2],
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function isDir(d) { return Object.prototype.hasOwnProperty.call(UNIT, d); }

// step defaults to STEP (walk); the avatar passes RUN_STEP when Shift-run is held.
// Diagonals are normalized so diagonal speed ≈ the cardinal speed.
export function move(pos, dir, step = STEP) {
  if (!isDir(dir)) return { x: pos.x, y: pos.y };
  const u = UNIT[dir];
  return {
    x: clamp(pos.x + Math.round(u[0] * step), AVATAR_R, WORLD_W - AVATAR_R),
    y: clamp(pos.y + Math.round(u[1] * step), AVATAR_R, WORLD_H - AVATAR_R),
  };
}
