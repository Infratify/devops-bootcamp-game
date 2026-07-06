import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

test('unresolvable profile → exit 1 with the --network arena lesson', async () => {
  const child = spawn(process.execPath, [INDEX], {
    env: { ...process.env, REDIS_HOST: 'no-such-host.invalid', SERVER: '' },
  });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(err, /--network arena/);
  assert.match(err, /profile/);
});
