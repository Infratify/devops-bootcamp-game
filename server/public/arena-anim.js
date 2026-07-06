// Pure movement→animation logic. No PIXI, no DOM. Unit-tested in avatar/test/anim.test.js.
// Sheet rows: 0=front(S) 1=¾-front 2=side 3=¾-back 4=back(N). Native turned rows face RIGHT.

export function facingFromVelocity(dx, dy, prev = { row: 0, flip: false }, diagRatio = 0.4) {
  if (dx === 0 && dy === 0) return prev;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.min(ax, ay) > Math.max(ax, ay) * diagRatio) {
    return { row: dy > 0 ? 1 : 3, flip: dx < 0 }; // ¾: down-diag=row1, up-diag=row3; mirror leftward
  }
  if (ax >= ay) return { row: 2, flip: dx < 0 };   // side; native faces right, mirror leftward
  return { row: dy < 0 ? 4 : 0, flip: false };      // up = back row, down = front row
}

export function isMoving(dx, dy, eps = 0.6) {
  return (dx * dx + dy * dy) > eps * eps;
}

export function frameAt(elapsedMs, fps, nFrames = 4) {
  return Math.floor((elapsedMs * fps) / 1000) % nFrames;
}
