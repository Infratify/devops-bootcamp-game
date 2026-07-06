export function parse(raw) {
  try { const m = JSON.parse(raw); return (m && typeof m === 'object') ? m : null; }
  catch { return null; }
}
export const rosterMsg = (players) => JSON.stringify({ t: 'roster', players });
export const welcomeMsg = (id) => JSON.stringify({ t: 'welcome', id });
