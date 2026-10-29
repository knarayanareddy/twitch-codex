const $ = (selector) => document.querySelector(selector);
const joinPanel = $('#join-panel'); const contributePanel = $('#contribute-panel'); const joinFeedback = $('#join-feedback'); const feedback = $('#contribution-feedback');
let current = null; let submittedRound = null; let stream = null; let submitting = false; let personalStatus = null; let streamLost = false;
const icons = { flowers: '✿', shade: '⌂', water: '≈' };
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || 'Quiet Quest could not complete that action.'); error.status = response.status; error.data = data; throw error; }
  return data;
}
function setFeedback(message, kind = '') { const className = `persistent-feedback${kind ? ` ${kind}` : ''}`; if (feedback.textContent === message && feedback.className === className) return; feedback.textContent = message; feedback.className = className; }
function updateSubmitButton() { if (current) $('#contribute-button').disabled = submitting || current.phase !== 'active' || !current.companionEnabled || submittedRound === current.round; }
function render(snapshot, alreadyContributed = false, statusMessage = null) {
  if (!snapshot) return;
  const roundChanged = current && current.round !== snapshot.round;
  current = snapshot;
  if (roundChanged) { submittedRound = null; personalStatus = null; }
  if (alreadyContributed) { submittedRound = snapshot.round; if (!personalStatus) personalStatus = 'You have already contributed this round. Your action counts equally with chat.'; }
  if (statusMessage) personalStatus = statusMessage;
  joinPanel.hidden = true; contributePanel.hidden = false;
  $('#round-status').textContent = snapshot.phase === 'active' ? `Round ${snapshot.round} is open for a fixed three-minute window. No countdown pressure; no speed bonus.` : snapshot.phase === 'paused' ? 'The streamer has paused this round. Your progress is safe.' : snapshot.phase === 'revealed' ? 'This round is complete. The next round will open when the streamer is ready.' : snapshot.phase === 'closed' ? 'This session has ended. Thanks for being part of the shared goal.' : 'Waiting for the next round.';
  const phasePill = $('#phase-pill'); phasePill.textContent = snapshot.phase === 'active' ? 'Round open' : snapshot.phase === 'paused' ? 'Paused' : snapshot.phase === 'revealed' ? 'Round complete' : 'Session ended'; phasePill.className = `phase-pill${snapshot.phase === 'paused' ? ' paused' : ['revealed','closed'].includes(snapshot.phase) ? ' closed' : ''}`;
  $('#progress-count').textContent = `${snapshot.total} / ${snapshot.goal}`; $('#shared-meter').max = snapshot.goal; $('#shared-meter').value = snapshot.total;
  $('#progress-note').textContent = `Chat ${snapshot.sourceCounts.chat} · Companion ${snapshot.sourceCounts.companion} · actions all count equally.`;
  const fieldset = $('#action-choices');
  if (!fieldset.querySelector('input[type="radio"]')) for (const action of snapshot.actions) {
    const id = `action-${action.id}`; const label = node('label', 'action-choice'); label.htmlFor = id;
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'actionId'; radio.value = action.id; radio.id = id;
    const text = document.createElement('span'); text.append(node('strong', '', action.label), node('small', '', `${action.count} added · equal contribution value`));
    label.append(radio, text, node('span', 'action-symbol', icons[action.id] || '•')); fieldset.append(label);
    radio.addEventListener('change', () => { document.querySelectorAll('.action-choice').forEach((choice) => choice.classList.remove('selected')); label.classList.add('selected'); });
  } else {
    for (const action of snapshot.actions) { const small = fieldset.querySelector(`#action-${action.id} + span small`); if (small) small.textContent = `${action.count} added · equal contribution value`; }
  }
  updateSubmitButton();
  if (snapshot.phase === 'closed') setFeedback('This session has ended. Ask the streamer for a new companion link.');
  else if (snapshot.phase === 'paused') setFeedback('The game is paused. Your selection is saved; submit when the streamer resumes.');
  else if (!snapshot.companionEnabled) setFeedback('The streamer has temporarily disabled companion input.');
  else if (submittedRound === snapshot.round) setFeedback(personalStatus || 'You have already contributed this round. Your action counts equally with chat.', 'success');
  else if (snapshot.phase === 'revealed') setFeedback(snapshot.outcome?.text || 'This round is complete.');
  else if (!feedback.textContent || !feedback.classList.contains('error')) setFeedback('Choose one action. Your contribution is counted once for this browser token each round.');
}
async function join(code) {
  joinFeedback.textContent = 'Checking the session code…'; joinFeedback.classList.remove('error');
  try { const result = await api('/api/companion/join', { method: 'POST', body: JSON.stringify({ code }) }); history.replaceState(null, '', '/companion'); render(result.snapshot, false); connectStream(); $('#contribute-title').focus?.(); }
  catch (error) { joinFeedback.textContent = error.message; joinFeedback.classList.add('error'); $('#session-code').focus(); }
}
async function loadExisting() {
  try { const result = await api('/api/companion/snapshot'); render(result.snapshot, result.alreadyContributed); connectStream(); return true; }
  catch (error) {
    if (error.status === 410) { joinFeedback.textContent = 'This companion session has ended or is unavailable. Ask the streamer for a current link.'; joinFeedback.classList.add('error'); }
    return false;
  }
}
function connectStream() {
  if (stream) stream.close();
  stream = new EventSource('/api/companion/events');
  stream.onopen = () => {
    if (!streamLost) return;
    streamLost = false; const status = $('#connection-feedback'); status.textContent = 'Live updates restored. The server checks the current round before accepting an action.'; status.hidden = false;
  };
  stream.addEventListener('snapshot', (event) => { try { render(JSON.parse(event.data).snapshot); } catch { setFeedback('Live progress is reconnecting. Your selected action is still here.'); } });
  stream.onerror = () => {
    if (streamLost) return;
    streamLost = true; const status = $('#connection-feedback'); status.textContent = 'Live progress connection interrupted. Your selection stays here; the server will check whether the round is still open.'; status.hidden = false;
  };
}
$('#join-form').addEventListener('submit', async (event) => { event.preventDefault(); const code = $('#session-code').value.trim(); if (code) await join(code); });
$('#contribution-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!current || submitting) return;
  const actionId = new FormData(event.currentTarget).get('actionId'); if (!actionId) { setFeedback('Choose one of the three garden actions first.', 'error'); return; }
  submitting = true; $('#contribute-button').disabled = true; setFeedback('Sending your contribution…');
  try {
    const result = await api('/api/companion/contribute', { method: 'POST', body: JSON.stringify({ actionId, round: current.round }) });
    current = result.snapshot;
    if (result.accepted) { submittedRound = current.round; render(current, true, 'Contribution recorded. It counts equally with a chat contribution. Thank you for helping.'); }
    else if (result.reason === 'already-contributed') { submittedRound = current.round; render(current, true, 'You have already contributed this round. Your earlier action remains in the shared total.'); }
    else { render(current); setFeedback('That round is not accepting contributions. Your selection is still here if another round opens.', 'error'); }
  } catch (error) {
    if (error.data?.reason === 'already-contributed' && error.data.snapshot) { current = error.data.snapshot; submittedRound = current.round; render(current, true, 'You have already contributed this round. Your earlier action remains in the shared total.'); }
    else setFeedback(`${error.message} Your selection is still here so you can retry if the round remains open.`, 'error');
  } finally { submitting = false; updateSubmitButton(); }
});
const initialCode = location.hash.slice(1);
loadExisting().then((joined) => { if (!joined && initialCode) { $('#session-code').value = initialCode; void join(initialCode); } });
