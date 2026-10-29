// Client-side Mock Backend for Context Desk (GitHub Pages Demo)
(function () {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('context_desk_channel') : null;

  const initialQuestions = [
    {
      id: 'q-pluto',
      question: 'Why does Pluto not meet the IAU planet definition?',
      status: 'review-required',
      submittedAt: Date.now() - 180000,
      actorLabel: 'Moderator · chat',
      publicQuestion: 'How do astronomers define a planet?',
      title: 'How astronomers define a planet',
      bullets: [
        'A planet orbits the Sun and is nearly round under its own gravity.',
        'It must also clear the neighbourhood around its orbit.',
        'Pluto meets the first two criteria, but not the third under the 2006 IAU definition.'
      ],
      summary: 'Under the International Astronomical Union’s 2006 Solar System definition, a planet orbits the Sun, is nearly round under its own gravity, and has cleared its orbital neighbourhood. Pluto meets the first two criteria but not the third, so it is classified as a dwarf planet under that definition.',
      uncertainty: 'This summarizes one formal classification. The source notes continuing discussion about terminology; it is not a universal statement about every planetary system.',
      evidence: [
        {
          id: 'nasa-planet-definition',
          sourceTitle: 'What is a Planet?',
          publisher: 'NASA Science',
          url: 'https://science.nasa.gov/solar-system/planets/what-is-a-planet/',
          checkedAt: '2026-10-28',
          excerpt: "NASA's explainer describes the International Astronomical Union's 2006 definition: a planet orbits the Sun, is nearly round because of its own gravity, and has cleared its orbital neighbourhood. Pluto meets the first two criteria but not the third under that definition. The page also notes that terminology and classification continue to be discussed."
        },
        {
          id: 'jpl-planet-definition',
          sourceTitle: 'What is a Planet?',
          publisher: 'NASA Jet Propulsion Laboratory, Solar System Dynamics',
          url: 'https://ssd.jpl.nasa.gov/planets/def.html',
          checkedAt: '2026-10-28',
          excerpt: 'JPL’s Solar System Dynamics resource explains the three-part IAU definition and distinguishes classical planets from dwarf planets and small solar system bodies.'
        }
      ]
    },
    {
      id: 'q-distance',
      question: 'What is the difference between a light-year and an astronomical unit?',
      status: 'review-required',
      submittedAt: Date.now() - 120000,
      actorLabel: 'Moderator · chat',
      publicQuestion: 'How do an astronomical unit and a light-year differ?',
      title: 'Two useful scales for cosmic distance',
      bullets: [
        'One astronomical unit is about the Earth–Sun distance (~150M km).',
        'A light-year is the distance light travels in one Julian year (~9.46T km).',
        'Despite its name, a light-year measures distance, not duration.'
      ],
      summary: 'An astronomical unit (AU) is approximately the Earth–Sun distance and is useful within our Solar System. A light-year is the distance light travels in one year, so it is a distance—not a duration—and is more practical for distances between stars.',
      uncertainty: 'The pack rounds the Earth–Sun distance to about 150 million kilometres and the light-year to about 9 trillion kilometres; consult NASA for exact conventions.',
      evidence: [
        {
          id: 'nasa-cosmic-distances',
          sourceTitle: 'Cosmic Distances',
          publisher: 'NASA Science',
          url: 'https://science.nasa.gov/learn/basics-of-space-flight/chapter2-1/',
          checkedAt: '2026-10-28',
          excerpt: 'Astronomical units describe distances within planetary systems; light-years describe distances between stars.'
        }
      ]
    },
    {
      id: 'q-saturn',
      question: 'What is the current count of Saturn moons right now?',
      status: 'insufficient-evidence',
      submittedAt: Date.now() - 60000,
      actorLabel: 'Moderator · chat',
      publicQuestion: 'Saturn satellite count (live)',
      title: 'Insufficient verified evidence in pack',
      bullets: [],
      summary: 'This topic cannot be reliably answered from the static Solar System Basics pack.',
      uncertainty: 'Live moon counts change as new discoveries and provisional designations are confirmed. The curated pack does not track volatile real-time counts.',
      evidence: []
    }
  ];

  function getStoredQuestions() {
    try {
      const data = localStorage.getItem('context_desk_questions');
      return data ? JSON.parse(data) : initialQuestions;
    } catch {
      return initialQuestions;
    }
  }

  function saveQuestions(list) {
    try { localStorage.setItem('context_desk_questions', JSON.stringify(list)); } catch {}
  }

  function getPublishedCard() {
    try {
      const data = localStorage.getItem('context_desk_published_card');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function setPublishedCard(card) {
    try {
      if (card) localStorage.setItem('context_desk_published_card', JSON.stringify(card));
      else localStorage.removeItem('context_desk_published_card');
    } catch {}
    if (channel) {
      channel.postMessage({ type: 'snapshot', card });
    }
  }

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (resource, options = {}) {
    const urlString = typeof resource === 'string' ? resource : resource.url;
    const url = new URL(urlString, location.href);

    if (url.pathname.startsWith('/api/')) {
      const method = (options.method || 'GET').toUpperCase();

      // Auth status
      if (url.pathname === '/api/auth/status') {
        return new Response(JSON.stringify({ authenticated: true, demoMode: true, broadcaster: 'demo_streamer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Login
      if (url.pathname === '/api/auth/login') {
        return new Response(JSON.stringify({ ok: true, broadcaster: 'demo_streamer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Config
      if (url.pathname === '/api/config') {
        return new Response(JSON.stringify({
          version: '1.0.0',
          overlayPath: './overlay.html?session=demo-session-context-desk-12345678',
          viewerPollPath: './vote.html?session=demo-session-context-desk-12345678',
          topicPack: {
            id: 'solar-system-basics',
            title: 'Solar System Basics',
            version: '1.0.0',
            topic: 'A bounded, low-stakes introduction to solar-system terminology, objects, and scale.'
          },
          twitch: { state: 'demo' },
          questions: getStoredQuestions(),
          session: {
            publishedCard: getPublishedCard()
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Questions List
      if (url.pathname === '/api/questions' && method === 'GET') {
        return new Response(JSON.stringify({ questions: getStoredQuestions() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Single Question
      const qMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
      if (qMatch && method === 'GET') {
        const id = qMatch[1];
        const q = getStoredQuestions().find((item) => item.id === id);
        if (!q) return new Response(JSON.stringify({ error: { message: 'Question not found' } }), { status: 404 });
        return new Response(JSON.stringify({ question: q }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Approve Question
      const approveMatch = url.pathname.match(/^\/api\/questions\/([^/]+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const id = approveMatch[1];
        const body = options.body ? JSON.parse(options.body) : {};
        const questions = getStoredQuestions();
        const q = questions.find((item) => item.id === id);
        if (q) {
          q.status = 'published';
          q.approvedAt = Date.now();
          saveQuestions(questions);
          const card = {
            id: q.id,
            publicQuestion: body.publicQuestion || q.publicQuestion,
            title: body.title || q.title,
            bullets: body.bullets || q.bullets,
            summary: body.summary || q.summary,
            uncertainty: body.uncertainty || q.uncertainty,
            evidence: q.evidence,
            reviewLabel: 'Broadcaster approved',
            provenanceLabel: 'Human verified & edited',
            expiresAt: Date.now() + 86400000
          };
          setPublishedCard(card);
          return new Response(JSON.stringify({ ok: true, card, question: q }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Reject / Insufficient
      const actionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)\/(reject|insufficient|cancel)$/);
      if (actionMatch && method === 'POST') {
        const id = actionMatch[1];
        const action = actionMatch[2];
        const questions = getStoredQuestions();
        const q = questions.find((item) => item.id === id);
        if (q) {
          q.status = action === 'reject' ? 'rejected' : action === 'insufficient' ? 'insufficient-evidence' : 'cancelled';
          saveQuestions(questions);
          return new Response(JSON.stringify({ ok: true, question: q }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Overlay fetch
      if (url.pathname.startsWith('/api/overlay/')) {
        return new Response(JSON.stringify({ ok: true, card: getPublishedCard() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Viewer Poll
      if (url.pathname.startsWith('/api/vote/')) {
        let poll = {
          question: 'Which topic should Context Desk investigate next?',
          choices: [
            { id: 'comet-tails', question: 'Why do comets grow visible tails near the Sun?', votes: 5 },
            { id: 'kuiper-belt', question: 'How do astronomers map the Kuiper Belt objects?', votes: 9 },
            { id: 'oort-cloud', question: 'What marks the outer gravitational edge of our Solar System?', votes: 3 }
          ],
          totalVotes: 17,
          alreadyVoted: Boolean(localStorage.getItem('context_desk_voted'))
        };
        if (method === 'POST') {
          const body = options.body ? JSON.parse(options.body) : {};
          const c = poll.choices.find((item) => item.id === body.choiceId);
          if (c) c.votes += 1;
          poll.totalVotes += 1;
          poll.alreadyVoted = true;
          localStorage.setItem('context_desk_voted', '1');
          return new Response(JSON.stringify({ accepted: true, ...poll }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify(poll), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Export recap
      if (url.pathname.includes('/recap')) {
        const card = getPublishedCard() || initialQuestions[0];
        const md = `# Context Desk Session Recap\n\n**Published Card:** ${card.title}\n**Question:** ${card.publicQuestion}\n\n## Summary\n${card.summary}\n\n## Caveats\n${card.uncertainty}\n`;
        return new Response(md, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown', 'Content-Disposition': 'attachment; filename="context-desk-recap.md"' }
        });
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // Mock EventSource
  class MockEventSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      setTimeout(() => {
        if (url.includes('overlay')) {
          const card = getPublishedCard();
          this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ card }) }));
        }
      }, 50);

      if (channel) {
        channel.onmessage = (event) => {
          if (event.data.type === 'snapshot') {
            this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ card: event.data.card }) }));
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
