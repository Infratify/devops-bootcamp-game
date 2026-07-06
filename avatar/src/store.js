import { createClient } from 'redis';

export async function createRedisStore(host, { connectTimeout = 3000, maxRetries = 3 } = {}) {
  const client = createClient({
    url: `redis://${host}:6379`,
    socket: {
      connectTimeout,
      reconnectStrategy: (retries) => (retries >= maxRetries ? new Error('profile unreachable') : Math.min(retries * 200, 800)),
    },
  });
  client.on('error', () => { /* surfaced via connect() rejection; not fatal after connect */ });
  try {
    await client.connect();
  } catch (err) {
    const e = new Error(`Could not connect to profile store at "${host}"`);
    e.code = 'PROFILE_UNREACHABLE';
    e.cause = err;
    throw e;
  }
  return {
    async get(k) { return client.get(k); },
    async set(k, v) { return client.set(k, v); },
    async save() { try { return await client.save(); } catch { /* SAVE can fail if a bgsave is mid-flight; safe to skip */ } },
    async quit() { try { await client.quit(); } catch { /* ignore */ } },
  };
}
