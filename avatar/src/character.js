import { WORLD_W, WORLD_H, AVATAR_R } from './constants.js';

export const DEFAULT_COLOUR = 'aqua';

export function resolveColour(envColour, storedColour) {
  const pick = [envColour, storedColour].find((c) => typeof c === 'string' && c.trim());
  return (pick || DEFAULT_COLOUR).trim();
}

export function spawn() {
  const m = AVATAR_R;
  return {
    x: Math.round(m + Math.random() * (WORLD_W - 2 * m)),
    y: Math.round(m + Math.random() * (WORLD_H - 2 * m)),
  };
}

export async function loadOrInit(store, { colour } = {}) {
  const [nama, storedColour, scoreRaw, xRaw, yRaw] = await Promise.all([
    store.get('nama'), store.get('colour'), store.get('score'), store.get('x'), store.get('y'),
  ]);

  const resolvedColour = resolveColour(colour, storedColour);
  const score = (scoreRaw != null && Number.isFinite(Number(scoreRaw))) ? Math.max(0, Math.floor(Number(scoreRaw))) : 0;
  let x = (xRaw != null && Number.isFinite(Number(xRaw))) ? Number(xRaw) : NaN;
  let y = (yRaw != null && Number.isFinite(Number(yRaw))) ? Number(yRaw) : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { const s = spawn(); x = s.x; y = s.y; }

  await store.set('colour', resolvedColour);
  await store.set('score', String(score));
  await store.set('x', String(Math.round(x)));
  await store.set('y', String(Math.round(y)));
  await store.save();

  return { nama: nama || null, colour: resolvedColour, score, x, y };
}
