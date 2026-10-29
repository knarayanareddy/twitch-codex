// Client-side Mock Backend for Quiet Quest (GitHub Pages Demo)
(function () {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('quiet_quest_channel') : null;

  function defaultSession() {
    return {
      sessionId: 'demo-session-qq-1234',
      phase: 'active',
      round: 1,
      mode: 'demo',
      goal: 12,
      total: 3,
      timeRemainingMs: 180000,
      startedAt: Date.now(),
      connectionState: 'connected',
      instruction: 'Choose one of three ways to contribute. No speed bonus.',
      sourceCounts: { chat: 2, companion: 1 },
      actions: [
        { id: 'plant-flowers', label: 'Plant native flowers', count: 1 },
        { id: 'create-shade', label: 'Create shade canopy', count: 1 },
        { id: 'set-water', label: 'Set out shallow water dish', count: 1 }
      ]
    };
  }

  function getSession() {
    try {
      const data = localStorage.getItem('quiet_quest_session');
      return data ? JSON.parse(data) : defaultSession();
    } catch {
      return defaultSession();
    }
  }

  function saveSession(sess) {
    try {
      if (sess) localStorage.setItem('quiet_quest_session', JSON.stringify(sess));
      else localStorage.removeItem('quiet_quest_session');
    } catch {}
    if (channel) {
      channel.postMessage({ type: 'session_update', session: sess });
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (resource, options = {}) {
    const urlString = typeof resource === 'string' ? resource : resource.url;
    const url = new URL(urlString, location.href);

    if (url.pathname.startsWith('/api/')) {
      const method = (options.method || 'GET').toUpperCase();

      // Config
      if (url.pathname === '/api/config') {
        const session = getSession();
        return new Response(JSON.stringify({
          demoMode: true,
          twitch: { state: 'connected', broadcasterLogin: 'demo_channel', oauthReady: true },
          session: session,
          companionUrl: './companion.html#code=QUIET123'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Start demo
      if (url.pathname === '/api/sessions/demo' && method === 'POST') {
        const session = defaultSession();
        session.startedAt = Date.now();
        saveSession(session);
        return new Response(JSON.stringify({ ok: true, session, companionUrl: './companion.html#code=QUIET123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Actions (pause, resume, close, end, reset, next)
      const actionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/action$/);
      if (actionMatch && method === 'POST') {
        const body = options.body ? JSON.parse(options.body) : {};
        const session = getSession();
        if (body.action === 'pause') session.phase = 'paused';
        else if (body.action === 'resume') session.phase = 'active';
        else if (body.action === 'close') session.phase = 'revealed';
        else if (body.action === 'next') {
          session.phase = 'active';
          session.round += 1;
          session.total = 0;
          session.sourceCounts = { chat: 0, companion: 0 };
          session.actions.forEach((a) => a.count = 0);
          session.timeRemainingMs = 180000;
        } else if (body.action === 'end') session.phase = 'closed';
        else if (body.action === 'reset') {
          const reset = defaultSession();
          saveSession(reset);
          return new Response(JSON.stringify({ ok: true, session: reset }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        saveSession(session);
        return new Response(JSON.stringify({ ok: true, session }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Simulate chat
      if (url.pathname.includes('/demo-chat') && method === 'POST') {
        const session = getSession();
        const body = options.body ? JSON.parse(options.body) : {};
        const actionId = body.actionId || 'plant-flowers';
        const target = session.actions.find((a) => a.id === actionId) || session.actions[0];
        target.count += 1;
        session.total += 1;
        session.sourceCounts.chat += 1;
        saveSession(session);
        return new Response(JSON.stringify({ ok: true, session }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Companion join
      if (url.pathname === '/api/companion/join' && method === 'POST') {
        const session = getSession();
        return new Response(JSON.stringify({
          ok: true,
          session: {
            round: session.round,
            phase: session.phase,
            actions: session.actions,
            timeRemainingMs: session.timeRemainingMs
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Companion contribute
      if (url.pathname === '/api/companion/contribute' && method === 'POST') {
        const session = getSession();
        const body = options.body ? JSON.parse(options.body) : {};
        const actionId = body.actionId || 'create-shade';
        const target = session.actions.find((a) => a.id === actionId) || session.actions[1];
        target.count += 1;
        session.total += 1;
        session.sourceCounts.companion += 1;
        saveSession(session);
        return new Response(JSON.stringify({
          ok: true,
          accepted: true,
          session: {
            round: session.round,
            phase: session.phase,
            actions: session.actions
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Recap export
      if (url.pathname.includes('/recap')) {
        const session = getSession();
        const csv = `round,goal,total,chat_contributions,companion_contributions\n1,12,${session.total},${session.sourceCounts.chat},${session.sourceCounts.companion}\n`;
        return new Response(csv, {
          status: 200,
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="quiet-quest-recap.csv"' }
        });
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // Mock EventSource for Quiet Quest
  class MockEventSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      setTimeout(() => {
        const session = getSession();
        this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(session) }));
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(session) }));
      }, 50);

      if (channel) {
        channel.onmessage = (event) => {
          if (event.data.type === 'session_update') {
            this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(event.data.session) }));
            this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event.data.session) }));
          }
        };
      }
    }
    close() {
      this.readyState = 2;
    }
  }

  window.EventSource = MockEventSource;
})();
