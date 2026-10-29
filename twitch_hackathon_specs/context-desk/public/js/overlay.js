const cardRoot = document.querySelector('#overlay-card');
function node(tag, cls, text) { const item = document.createElement(tag); if (cls) item.className = cls; if (text != null) item.textContent = text; return item; }
function render(card) {
  cardRoot.replaceChildren(); cardRoot.hidden = !card;
  if (!card) return;
  const eyebrow = node('div', 'overlay-eyebrow'); const dot = node('span', 'overlay-dot'); eyebrow.append(dot, document.createTextNode(`${card.reviewLabel || 'Human reviewed'} · CONTEXT DESK`));
  cardRoot.append(eyebrow, node('p', 'overlay-question', card.publicQuestion || 'Approved research question'), node('h1', 'overlay-title', card.title));
  const bullets = node('ul', 'overlay-bullets'); for (const bullet of (card.bullets || []).slice(0, 3)) bullets.append(node('li', '', bullet)); if (bullets.childElementCount) cardRoot.append(bullets);
  cardRoot.append(node('p', 'overlay-summary', card.summary), node('p', 'overlay-uncertainty', `What we cannot conclude: ${card.uncertainty}`));
  const links = node('div', 'overlay-sources');
  for (const source of (card.evidence || []).slice(0, 2)) {
    try {
      const link = new URL(source.url);
      if (link.protocol !== 'https:' || !['science.nasa.gov', 'ssd.jpl.nasa.gov'].includes(link.hostname)) continue;
      const anchor = node('a', '', `${source.sourceTitle} · ${link.hostname} ↗`); anchor.href = link.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      anchor.setAttribute('aria-label', `${source.sourceTitle} from ${source.publisher}, opens in a new tab`); links.append(anchor);
    } catch { /* Invalid source URLs are never rendered. */ }
  }
  if (links.childElementCount) cardRoot.append(links);
  const provenance = card.provenanceLabel || card.reviewLabel || 'Broadcaster approved';
  cardRoot.append(node('div', 'overlay-foot', `${provenance} · Context Desk · expires ${new Date(card.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
}
async function connect() {
  const key = new URL(location.href).searchParams.get('session');
  if (!key || !/^[a-f0-9]{24,64}$/i.test(key)) return;
  try {
    const response = await fetch(`/api/overlay/${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json(); render(data.card);
    const events = new EventSource(`/api/overlay/${encodeURIComponent(key)}/events`);
    events.addEventListener('snapshot', (event) => { try { render(JSON.parse(event.data).card); } catch { render(null); } });
    events.onerror = () => { /* EventSource retries; last approved snapshot stays visible. */ };
  } catch { render(null); }
}
connect();
