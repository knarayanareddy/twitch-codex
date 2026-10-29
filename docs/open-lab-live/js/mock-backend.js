// Client-side Mock Backend for Open Lab Live (GitHub Pages Demo)
(function () {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('open_lab_channel') : null;

  const LESSON = {
    id: 'albedo-lab',
    version: '1.0.0',
    title: 'Earth Surface Albedo & Absorption',
    level: 'Middle / High School',
    readingLevel: 'Accessible (approx. Grade 7)',
    objective: 'Explore how surface reflectivity (albedo) influences energy absorption under identical incoming light.',
    prompt: 'With the same incoming solar energy, which surface absorbs the greatest number of model units?',
    incomingEnergyOptions: [100],
    choices: [
      { id: 'asphalt', number: 1, label: 'Dark asphalt / open ocean', shortLabel: 'Dark surface', albedoPercent: 20, swatch: '#2a2f35', predictions: 3 },
      { id: 'grass', number: 2, label: 'Grassland / mixed forest', shortLabel: 'Vegetated surface', albedoPercent: 50, swatch: '#3f6c45', predictions: 1 },
      { id: 'snow', number: 3, label: 'Fresh snow / sea ice', shortLabel: 'Bright ice/snow', albedoPercent: 80, swatch: '#dce5ed', predictions: 1 }
    ],
    simulation: {
      unit: 'model energy units',
      formula: 'absorbed = incoming × (100 − albedo) ÷ 100'
    },
    source: {
      publisher: 'NASA Science',
      title: 'Explore Albedo Activity',
      checked: '2026-10-29',
      supports: 'Qualitative relationship: lower albedo reflects less light and absorbs more energy.',
      url: 'https://science.nasa.gov/wp-content/uploads/2023/10/Explore-Albedo-Activity.pdf'
    },
    whatItRepresents: [
      'A proportional mathematical rule: darker surfaces absorb a greater share of light.',
      'Controlled-variable comparison: incoming energy is held constant across all conditions.',
      'Conservation of energy units: absorbed + reflected = incoming energy.'
    ],
    whatItDoesNotRepresent: [
      'Not a temperature forecast, greenhouse gas simulation, or climate prediction.',
      'Not real-world meteorological or satellite radiometer measurements.'
    ],
    moderationExamples: {
      safe: ['!predict 1 (voting for dark surface)'],
      outOfScope: ['What will the weather in Paris be on Tuesday?'],
      handlingNote: 'Direct viewers back to the controlled 3-choice classroom prompt.'
    }
  };

  function defaultSession() {
    return {
      sessionId: 'demo-session-lab-1234',
      lessonId: 'albedo-lab',
      lessonVersion: '1.0.0',
      phase: 'predict',
      seed: 'seed-open-lab-2026',
      incomingEnergy: 100,
      choices: JSON.parse(JSON.stringify(LESSON.choices)),
      predictionTotal: 5,
      leadingChoiceId: 'asphalt',
      selectedChoiceId: 'asphalt',
      predictionResult: 'plurality',
      timeRemainingMs: 90000,
      mode: 'demo',
      tested: null,
      comparison: null,
      explanation: null,
      limitation: null
    };
  }

  function getSession() {
    try {
      const data = localStorage.getItem('open_lab_session');
      return data ? JSON.parse(data) : defaultSession();
    } catch {
      return defaultSession();
    }
  }

  function saveSession(sess) {
    try {
      if (sess) localStorage.setItem('open_lab_session', JSON.stringify(sess));
      else localStorage.removeItem('open_lab_session');
    } catch {}
    if (channel) {
      channel.postMessage({ type: 'lab_update', session: sess });
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (resource, options = {}) {
    const urlString = typeof resource === 'string' ? resource : resource.url;
    const url = new URL(urlString, location.href);

    if (url.pathname.startsWith('/api/')) {
      const method = (options.method || 'GET').toUpperCase();

      if (url.pathname === '/api/health') {
        return new Response(JSON.stringify({ ok: true, app: 'Open Lab Live', version: '1.0.0', phase: getSession().phase }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/api/auth/status') {
        return new Response(JSON.stringify({ authenticated: true, demoMode: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/api/studio') {
        const session = getSession();
        return new Response(JSON.stringify({
          lesson: LESSON,
          session: session,
          twitch: { state: 'offline' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/api/sessions' && method === 'POST') {
        const sess = defaultSession();
        saveSession(sess);
        return new Response(JSON.stringify({ ok: true, session: sess }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname.includes('/demo-vote') && method === 'POST') {
        const body = options.body ? JSON.parse(options.body) : {};
        const session = getSession();
        const choiceNum = Number(body.choiceNumber) || 1;
        const target = session.choices.find((c) => c.number === choiceNum);
        if (target) {
          target.predictions += 1;
          session.predictionTotal += 1;
          saveSession(session);
        }
        return new Response(JSON.stringify({ ok: true, session }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Actions (close, choose, reveal, reset)
      const actionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/([^/]+)$/);
      if (actionMatch && method === 'POST') {
        const action = actionMatch[2];
        const body = options.body ? JSON.parse(options.body) : {};
        const session = getSession();

        if (action === 'close') {
          session.phase = 'choose';
        } else if (action === 'choose') {
          session.selectedChoiceId = body.choiceId || session.leadingChoiceId || 'asphalt';
          session.phase = 'reveal';
        } else if (action === 'reveal') {
          session.phase = 'learn';
          const selectedChoice = session.choices.find((c) => c.id === session.selectedChoiceId) || session.choices[0];
          const incoming = session.incomingEnergy;
          const absorbed = Math.round(incoming * (100 - selectedChoice.albedoPercent) / 100);
          session.tested = {
            choiceId: selectedChoice.id,
            albedoPercent: selectedChoice.albedoPercent,
            incomingEnergy: incoming,
            absorbedEnergy: absorbed,
            reflectedEnergy: incoming - absorbed,
            unit: 'model energy units'
          };
          session.comparison = session.choices.map((c) => ({
            choiceId: c.id,
            number: c.number,
            label: c.shortLabel,
            albedoPercent: c.albedoPercent,
            incomingEnergy: incoming,
            absorbedEnergy: Math.round(incoming * (100 - c.albedoPercent) / 100),
            reflectedEnergy: incoming - Math.round(incoming * (100 - c.albedoPercent) / 100)
          }));
          session.explanation = `In this model, ${incoming} incoming model units × (100 − ${selectedChoice.albedoPercent}% reflected) ÷ 100 = ${absorbed} absorbed and ${incoming - absorbed} reflected. Lower albedo means a larger absorbed share.`;
          session.limitation = 'This is arithmetic in model units, not a field measurement or climate prediction.';
        } else if (action === 'reset') {
          const reset = defaultSession();
          saveSession(reset);
          return new Response(JSON.stringify({ ok: true, session: reset }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        saveSession(session);
        return new Response(JSON.stringify({ ok: true, session }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Overlay fetch
      if (url.pathname.startsWith('/api/overlay/')) {
        const session = getSession();
        return new Response(JSON.stringify(session), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Recap
      if (url.pathname.includes('/recap')) {
        const session = getSession();
        const md = `# Open Lab Live — Run Notes\n\n**Lesson:** ${LESSON.title}\n**Tested condition:** ${session.selectedChoiceId}\n**Output:** ${session.explanation || 'Revealed model units.'}\n\n**Source:** ${LESSON.source.title} (${LESSON.source.publisher})\n`;
        return new Response(md, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown', 'Content-Disposition': 'attachment; filename="open-lab-recap.md"' }
        });
      }
    }

    return originalFetch.apply(this, arguments);
  };

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
          if (event.data.type === 'lab_update') {
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
