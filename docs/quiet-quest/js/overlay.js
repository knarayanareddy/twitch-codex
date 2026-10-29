const $ = (selector) => document.querySelector(selector);
const root = $('#overlay-card'); const empty = $('#overlay-empty');
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; }
function phaseLabel(snapshot) { return ({ active: 'ROUND OPEN · NO SPEED BONUS', paused: 'GAME PAUSED', revealed: 'ROUND RESULT', closed: 'SESSION ENDED', ready: 'READY' })[snapshot.phase] || 'STATUS'; }
function connectionLabel(state) { return ({ connected: 'CHAT CONNECTED', simulated: 'SIMULATED CHAT', reconnecting: 'CHAT RECONNECTING', disconnected: 'CHAT OFFLINE', 'reauthorization-required': 'CHAT AUTH NEEDED' })[state] || 'CHAT STATUS'; }
function render(snapshot) {
  if (!snapshot) { root.hidden = true; empty.hidden = false; return; }
  empty.hidden = true; root.hidden = false;
  $('#overlay-round').textContent = `ROUND ${snapshot.round} · ${snapshot.phase.toUpperCase()}`;
  $('#overlay-state').textContent = phaseLabel(snapshot);
  $('#overlay-count').textContent = `${snapshot.total} / ${snapshot.goal}`;
  $('#overlay-meter').max = snapshot.goal; $('#overlay-meter').value = snapshot.total;
  $('#overlay-chat').textContent = `CHAT · ${snapshot.sourceCounts.chat}`;
  $('#overlay-companion').textContent = `COMPANION · ${snapshot.sourceCounts.companion}`;
  $('#overlay-connection').textContent = connectionLabel(snapshot.connectionState);
  $('#overlay-prompt').textContent = snapshot.phase === 'paused' ? 'The streamer has paused the contribution window. Your progress is safe.' : snapshot.phase === 'closed' ? 'This Quiet Quest session has ended. Thank you for helping the community.' : 'Choose one of three ways to help; no speed bonus.';
  const actions = $('#overlay-actions'); actions.replaceChildren();
  for (const action of snapshot.actions) { const item = node('div', 'overlay-action'); item.append(node('strong', '', action.label), node('span', '', String(action.count))); actions.append(item); }
  $('#overlay-instructions').textContent = snapshot.phase === 'closed' ? 'Watch for the next community round.' : snapshot.instruction;
  const outcome = $('#overlay-result'); outcome.hidden = !snapshot.outcome; if (snapshot.outcome) outcome.textContent = snapshot.outcome.text;
}
const session = new URL(location.href).searchParams.get('session');
if (!session || !/^[a-f0-9-]{36}$/i.test(session)) { empty.textContent = 'Quiet Quest · waiting for the shared garden'; }
else {
  fetch(`/api/overlay/${encodeURIComponent(session)}`, { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error('not-found'); const data = await response.json(); render(data.snapshot); }).catch(() => render(null));
  const stream = new EventSource(`/api/overlay/${encodeURIComponent(session)}/events`);
  stream.addEventListener('snapshot', (event) => { try { render(JSON.parse(event.data).snapshot); } catch { render(null); } });
}
