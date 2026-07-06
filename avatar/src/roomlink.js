import WebSocket from 'ws';

export function createRoomLink(serverAddr, { getJoinPayload, onWelcome, onRoster, onStatus } = {}) {
  const url = serverAddr ? `ws://${serverAddr}` : null;
  let ws = null, closed = false, attempt = 0, timer = null;
  const status = (c) => { onStatus && onStatus(c); };

  function connect() {
    if (closed || !url) return;
    ws = new WebSocket(url);
    ws.on('open', () => {
      attempt = 0;
      status(true);
      try { ws.send(JSON.stringify({ t: 'join', ...(getJoinPayload ? getJoinPayload() : {}) })); } catch { /* ignore */ }
    });
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m) return;
      if (m.t === 'welcome' && typeof m.id === 'string') onWelcome && onWelcome(m.id);
      else if (m.t === 'roster' && Array.isArray(m.players)) onRoster && onRoster(m.players);
    });
    ws.on('close', () => { status(false); scheduleReconnect(); });
    ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  }

  function scheduleReconnect() {
    if (closed || !url) return;
    attempt += 1;
    timer = setTimeout(connect, Math.min(500 * attempt, 5000));
  }

  if (url) connect(); else status(false);

  return {
    get connected() { return !!ws && ws.readyState === 1; },
    sendUpdate(u) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'update', ...u })); } catch { /* ignore */ } },
    close() { closed = true; if (timer) clearTimeout(timer); try { ws && ws.close(); } catch { /* ignore */ } },
  };
}
