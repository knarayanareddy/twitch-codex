const $ = (selector) => document.querySelector(selector);
const state = { config: null, session: null, eventSource: null, pendingAction: null, companionCode: null, companionUrl: null, clockDeadline: 0 };
function node(tag, cls = '', text = null) { const element = document.createElement(tag); if (cls) element.className = cls; if (text != null) element.textContent = text; return element; }
function toast(message) { const item = node('div', 'toast', message); $('#toast-region').append(item); setTimeout(() => item.remove(), 5000); }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `Request failed (${response.status}).`); error.status = response.status; error.code = data.error?.code; throw error; }
  return data;
}
function signIn(message = '') { if (state.eventSource) state.eventSource.close(); $('#studio').hidden = true; $('#login').hidden = false; $('#login-error').hidden = !message; $('#login-error').textContent = message; }
function showStudio() { $('#login').hidden = true; $('#studio').hidden = false; }
function setText(selector, text) { $(selector).textContent = text ?? ''; }
function connectionText(value, mode) {
  if (mode === 'demo') return 'Demo: chat command is simulated';
  return ({ connected: 'Chat connected to Twitch', reconnecting: 'Chat reconnecting · pause if you want to wait', disconnected: 'Chat offline', 'reauthorization-required': 'Twitch authorization needs attention', authorized: 'Broadcaster authorized · chat starts with a Live round' })[value] || 'Chat not connected';
}
function renderTwitch() {
  const t = state.config.twitch; const active = ['connected','reconnecting','authorized'].includes(t.state);
  setText('#twitch-label', t.state === 'connected' ? `Twitch · ${t.broadcasterLogin || 'connected'}` : t.state === 'authorized' ? `Authorized · ${t.broadcasterLogin || 'broadcaster'}` : t.state === 'reconnecting' ? 'Twitch chat reconnecting' : t.state === 'reauthorization-required' ? 'Twitch reauthorization required' : 'Twitch not connected');
  $('#twitch-label').className = `connection-label${t.state === 'connected' ? ' connected' : t.state === 'reauthorization-required' ? ' warning' : ''}`;
  $('#twitch-authorize').hidden = !t.oauthReady || active;
  $('#start-live').disabled = !['authorized','connected'].includes(t.state) || Boolean(state.session && state.session.phase !== 'closed');
  $('#start-live').textContent = t.oauthReady ? (active ? 'Start Live round' : 'Authorize Twitch first') : 'Twitch OAuth not configured';
  $('#twitch-disconnect').hidden = t.state === 'disconnected' || t.state === 'reauthorization-required' && !t.broadcasterLogin;
  if (t.state !== 'connected' && t.state !== 'authorized' && !t.note) setText('#setup-message', 'Demo works offline. Configure Twitch OAuth for Live mode.');
}
function renderActionCounts(snapshot) {
  const root = $('#action-counts'); root.replaceChildren();
  for (const action of snapshot.actions) { const card = node('article', 'contribution-card'); const copy = node('div'); copy.append(node('h4', '', action.label), node('p', '', 'One contribution · same value as every other action')); card.append(copy, node('strong', '', String(action.count))); root.append(card); }
  const actionSelect = $('#demo-action');
  if (!actionSelect.options.length) for (const action of snapshot.actions) { const option = document.createElement('option'); option.value = action.id; option.textContent = action.label; actionSelect.append(option); }
}
function updateRoundClock() {
  if (!state.session) return;
  const snap = state.session; let seconds = 0;
  if (snap.phase === 'active') seconds = Math.max(0, Math.ceil((state.clockDeadline - performance.now()) / 1000));
  else if (snap.phase === 'paused') seconds = Math.ceil(snap.timeRemainingMs / 1000);
  const text = snap.phase === 'active' || snap.phase === 'paused' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : snap.phase === 'revealed' ? 'Round complete' : snap.phase === 'closed' ? 'Session ended' : '—';
  setText('#round-clock', text);
}
function renderSession(snapshot) {
  if (!snapshot) { state.session = null; $('#active-session').hidden = true; $('#no-session').hidden = false; $('#setup').hidden = false; renderTwitch(); return; }
  state.session = snapshot; state.clockDeadline = performance.now() + (snapshot.timeRemainingMs || 0); $('#active-session').hidden = false; $('#no-session').hidden = true;
  setText('#round-number', String(snapshot.round)); setText('#goal-total', String(snapshot.total)); setText('#goal-target', String(snapshot.goal)); setText('#meter-summary', `${snapshot.total} / ${snapshot.goal} · all actions count equally`);
  $('#team-meter').max = snapshot.goal; $('#team-meter').value = snapshot.total;
  setText('#chat-count', `${snapshot.sourceCounts.chat} contributions`); setText('#companion-count', `${snapshot.sourceCounts.companion} contributions`);
  setText('#connection-detail', connectionText(snapshot.connectionState, snapshot.mode)); setText('#instructions-copy', snapshot.instruction);
  setText('#phase-badge', snapshot.phase === 'active' ? 'Round open' : snapshot.phase === 'paused' ? 'Game paused' : snapshot.phase === 'revealed' ? 'Round result' : snapshot.phase === 'closed' ? 'Session ended' : 'Ready');
  $('#phase-badge').className = `phase-badge${snapshot.phase === 'paused' ? ' paused' : snapshot.phase === 'closed' ? ' closed' : ''}`;
  $('#pause-resume').textContent = snapshot.phase === 'paused' ? 'Resume round' : snapshot.connectionState === 'reconnecting' ? 'Pause while reconnecting' : 'Pause round';
  $('#pause-resume').disabled = !['active','paused'].includes(snapshot.phase);
  $('#close-round').hidden = !['active','paused'].includes(snapshot.phase);
  $('#next-round').hidden = snapshot.phase !== 'revealed';
  $('#end-session').disabled = snapshot.phase === 'closed';
  $('#reset-session').hidden = false;
  $('#companion-enabled').checked = snapshot.companionEnabled; $('#companion-enabled').disabled = snapshot.phase === 'closed';
  $('#open-overlay').href = `/overlay?session=${encodeURIComponent(snapshot.sessionId)}`;
  $('#open-companion').href = state.companionUrl || '/companion';
  $('#demo-tools').hidden = snapshot.mode !== 'demo' || snapshot.phase !== 'active';
  renderActionCounts(snapshot); updateRoundClock();
  const result = $('#result-panel'); result.hidden = !snapshot.outcome; if (snapshot.outcome) setText('#result-copy', snapshot.outcome.text);
  if (state.companionCode) setText('#companion-code', state.companionCode); else setText('#companion-code', 'Create a fresh temporary code');
  renderTwitch();
}
function connectStudioStream() {
  if (state.eventSource) state.eventSource.close(); if (!state.session) return;
  state.eventSource = new EventSource(`/api/studio/${encodeURIComponent(state.session.sessionId)}/events`);
  state.eventSource.addEventListener('snapshot', (event) => { try { const result = JSON.parse(event.data); renderSession(result.snapshot); } catch {} });
  state.eventSource.onerror = () => { if (state.session?.mode === 'live') setText('#connection-detail', 'Studio reconnecting to server · pause if needed'); };
}
function renderRecap(sessions) {
  const root = $('#recap-list'); root.replaceChildren(); if (!sessions.length) { root.append(node('p', 'empty-copy', 'Completed rounds will appear here as aggregate totals only.')); return; }
  for (const item of [...sessions].reverse()) {
    const snap = item.snapshot; const card = node('article', 'recap-card'); card.append(node('h3', '', `Round ${snap.round} · ${snap.mode === 'demo' ? 'Demo simulation' : 'Live session'}`));
    card.append(node('p', '', snap.outcome?.text || (snap.phase === 'active' ? 'This round is in progress.' : snap.phase === 'paused' ? 'This round is paused.' : 'This session ended before a round result was revealed.')));
    card.append(node('p', 'recap-stats', `${snap.total} total · Chat ${snap.sourceCounts.chat} · Companion ${snap.sourceCounts.companion}`));
    const breakdown = node('p'); breakdown.textContent = snap.actions.map((action) => `${action.label}: ${action.count}`).join(' · '); card.append(breakdown); root.append(card);
  }
}
async function refresh() {
  try {
    state.config = await api('/api/studio'); showStudio(); renderTwitch(); renderRecap((await api('/api/recap')).sessions);
    const current = state.config.sessions?.[0]?.snapshot || null; state.companionCode = null; renderSession(current); connectStudioStream();
    if (current && current.phase !== 'closed') { $('#start-demo').disabled = true; $('#start-live').disabled = true; } else { $('#start-demo').disabled = false; }
  } catch (error) { if (error.status === 401) signIn(); else signIn(error.message); }
}
async function start(mode) {
  try {
    const result = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode }) }); state.companionCode = result.companionCode; state.companionUrl = result.companionUrl; renderSession(result.snapshot); connectStudioStream();
    $('#start-demo').disabled = true; $('#start-live').disabled = true; setText('#setup-message', mode === 'demo' ? 'Demo session started. Simulated chat commands are labelled and are not live Twitch messages.' : 'Live session started. EventSub is connecting; pause while it reconnects if needed.'); toast(mode === 'demo' ? 'Demo round is open. Share the companion link or use the labelled chat simulator.' : 'Live round is open. Chat messages are not stored.');
  } catch (error) { toast(error.message); }
}
async function sessionAction(action, body = {}) {
  if (!state.session) return;
  try { const result = await api(`/api/sessions/${state.session.sessionId}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    if (result.snapshot) { state.companionCode = result.companionCode || (action === 'reset' ? null : state.companionCode); state.companionUrl = result.companionUrl || state.companionUrl; renderSession(result.snapshot); if (action === 'reset') connectStudioStream(); }
    if (action === 'invite') { state.companionCode = result.companionCode; state.companionUrl = result.companionUrl; renderSession(state.session); toast('A new code is ready. The previous companion invite is revoked.'); }
    if (action === 'end') { $('#start-demo').disabled = false; renderRecap((await api('/api/recap')).sessions); toast('Session ended. Aggregate recap remains available for 24 hours.'); }
    if (action === 'reset') { renderRecap((await api('/api/recap')).sessions); toast('A fresh session has started with a new invite code.'); }
  } catch (error) { toast(error.message); }
}
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passcode: $('#passcode').value }) }); $('#passcode').value = ''; await refresh(); } catch (error) { signIn(error.message); }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {} signIn(); });
$('#start-demo').addEventListener('click', () => start('demo'));
$('#start-live').addEventListener('click', () => start('live'));
$('#twitch-disconnect').addEventListener('click', async () => { try { await api('/api/twitch/disconnect', { method: 'POST', body: JSON.stringify({}) }); await refresh(); toast('Twitch token removed from this installation.'); } catch (error) { toast(error.message); } });
$('#pause-resume').addEventListener('click', () => sessionAction(state.session?.phase === 'paused' ? 'resume' : 'pause'));
$('#close-round').addEventListener('click', () => sessionAction('close-round'));
$('#next-round').addEventListener('click', () => sessionAction('next'));
$('#companion-enabled').addEventListener('change', (event) => sessionAction('companion', { enabled: event.target.checked }));
$('#rotate-invite').addEventListener('click', () => sessionAction('invite'));
$('#copy-companion').addEventListener('click', async () => {
  if (!state.companionUrl) { await sessionAction('invite'); if (!state.companionUrl) return; }
  const url = new URL(state.companionUrl, location.origin).href;
  try { await navigator.clipboard.writeText(url); toast('Temporary companion link copied.'); } catch { window.prompt('Copy this temporary companion link:', url); }
});
$('#simulate-chat').addEventListener('click', async () => {
  if (!state.session) return;
  try { const result = await api(`/api/sessions/${state.session.sessionId}/demo-chat`, { method: 'POST', body: JSON.stringify({ actorId: $('#demo-actor').value, actionId: $('#demo-action').value }) }); renderSession(result.snapshot); setText('#demo-feedback', result.accepted ? 'Simulated command accepted. This is not a Twitch event.' : 'That sample participant already contributed this round.'); }
  catch (error) { setText('#demo-feedback', error.message); }
});
function askConfirm(action, title, copy) { state.pendingAction = action; setText('#confirm-title', title); setText('#confirm-copy', copy); $('#confirm-action').textContent = action === 'reset' ? 'Reset session' : 'End session'; $('#confirm-dialog').showModal(); }
$('#end-session').addEventListener('click', () => askConfirm('end', 'End this session?', 'The current round will stop accepting contributions. Aggregate recap remains for 24 hours.'));
$('#reset-session').addEventListener('click', () => askConfirm('reset', 'Reset this session?', 'The current session will close and a fresh round will start with a new companion code.'));
$('#confirm-dialog').addEventListener('close', () => { if ($('#confirm-dialog').returnValue === 'confirm' && state.pendingAction) void sessionAction(state.pendingAction); state.pendingAction = null; });
setInterval(updateRoundClock, 250);
async function boot() {
  const status = await api('/api/auth/status');
  if (status.authenticated) await refresh(); else signIn();
}
boot().catch((error) => signIn(error.message));
