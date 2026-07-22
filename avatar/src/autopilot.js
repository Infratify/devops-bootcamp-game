import { ACTIONS } from './messages.js';

// Directions the wander can walk (the 8 movement.js knows). Idle is dir === null.
const DIRS = ['up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'];

// Tuned so an NPC reads as "alive" on the projector: mostly walking, short idle
// beats, occasional run bursts, rare emote. Every choice comes from the injected
// rng() (0..1) so the wander is deterministic and testable — no hidden Math.random.
const P_IDLE = 0.18; // a new segment is a pause instead of a walk
const P_RUN = 0.22;  // a walking segment is a Shift-run
const P_ACT = 0.12;  // a new segment kicks off with a cosmetic one-shot
const MIN_TICKS = 10; // 0.5s at 50ms/tick
const MAX_TICKS = 40; // 2s

const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const span = (rng) => MIN_TICKS + Math.floor(rng() * (MAX_TICKS - MIN_TICKS + 1));

// Pure wander step. Given the current segment state + an rng, returns the next
// state and what to do THIS tick: dir (null = idle), a run flag, and an optional
// one-shot act (only ever set on the first tick of a fresh segment).
export function nextWander(state, rng) {
  const s = state || { dir: null, run: false, ticksLeft: 0 };
  if (s.ticksLeft > 1) {
    // Mid-segment: keep walking the same way, no new action.
    return { state: { dir: s.dir, run: s.run, ticksLeft: s.ticksLeft - 1 }, dir: s.dir, run: s.run, act: null };
  }
  // Segment ended (or first call) → start a fresh one.
  const idle = rng() < P_IDLE;
  const dir = idle ? null : pick(rng, DIRS);
  const run = !idle && rng() < P_RUN;
  const act = rng() < P_ACT ? pick(rng, ACTIONS) : null;
  return { state: { dir, run, ticksLeft: span(rng) }, dir, run, act };
}

// Force the current segment to end so the next nextWander() rerolls direction.
// The loop calls this when move() clamps at a wall (bot walked into the edge).
export function bounce(state) {
  return state ? { ...state, ticksLeft: 0 } : state;
}
