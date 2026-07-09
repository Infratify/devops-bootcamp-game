export const WORLD_W = 1600;
export const WORLD_H = 1000;
// STEP is per 50ms move (SEND_MS in avatar.js), matched to the server's 50ms roster
// broadcast so snapshots are evenly spaced — misaligned cadences (e.g. 12px/60ms vs a
// 50ms broadcast) alias into a periodic freeze/catch-up stutter. 10px/50ms = 200px/s.
export const STEP = 10;
export const RUN_STEP = 18;   // Shift-run: 360px/s, ~1.8× so clients read the higher speed as a run
export const AVATAR_R = 22;
