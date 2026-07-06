import { createServer } from './app.js';
const port = Number(process.env.PORT) || 3000;
createServer({ port });
console.log(`[arena] room listening on :${port}`);
