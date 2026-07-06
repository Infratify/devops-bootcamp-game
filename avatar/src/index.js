import { startAvatar } from './app.js';
import { createRedisStore } from './store.js';
import { createRoomLink } from './roomlink.js';

const BANNER =
  '\n────────────────────────────────────────────\n' +
  ' Could not find your remember-box "profile".\n' +
  ' Your avatar and your profile must be on the\n' +
  ' SAME network to find each other by name.\n' +
  ' Did you add   --network arena   to docker run?\n' +
  '────────────────────────────────────────────\n';

let app = null;
startAvatar({
  env: process.env,
  storeFactory: (host) => createRedisStore(host),
  roomFactory: (addr, handlers) => createRoomLink(addr, handlers),
})
  .then((a) => { app = a; console.log(`[arena] avatar view: http://localhost:${a.port}`); })
  .catch((err) => {
    if (err && err.code === 'PROFILE_UNREACHABLE') console.error(BANNER);
    else console.error('[arena] avatar failed to start:', err && err.message);
    process.exit(1);
  });

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (app) await app.close(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
