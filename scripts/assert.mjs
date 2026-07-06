// Usage: node assert.mjs <ws-url> <predicate-nama> [<min-score>]
// Connects as spectator, waits up to 5s for a roster containing <predicate-nama>
// with score >= min-score. Exit 0 on success, 1 on timeout/mismatch.
//
// `ws` is resolved via a CJS require() anchored to process.cwd() (not this
// file's location) so that running `cd server && node ../scripts/assert.mjs`
// picks up server/node_modules/ws. A plain ESM `import 'ws'` would resolve
// relative to this file's own directory (scripts/), which has no node_modules,
// so that approach does not work here.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'noop.cjs'));
const WebSocket = require('ws');
const [url, nama, minScore = '0'] = process.argv.slice(2);
const ws = new WebSocket(url);
const to = setTimeout(() => { console.error('timeout'); process.exit(1); }, 5000);
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'spectator' })));
ws.on('message', (d) => {
  let m; try { m = JSON.parse(d.toString()); } catch { return; }
  if (m.t !== 'roster') return;
  const p = m.players.find((x) => x.nama === nama);
  if (p && p.score >= Number(minScore)) { clearTimeout(to); console.log(`OK ${nama} score=${p.score}`); process.exit(0); }
});
ws.on('error', (e) => { console.error(String(e)); process.exit(1); });
