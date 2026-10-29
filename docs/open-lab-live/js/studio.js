const $ = (selector) => document.querySelector(selector);
const state = { config: null, session: null, eventSource: null, overlayHref: '/overlay?preview=1', clockDeadline: 0, pendingConfirm: null };
function node(tag, cls = '', text = null) { const element = document.createElement(tag); if (cls) element.className = cls; if (text != null) element.textContent = text; return element; }
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `Request failed (${response.status}).`); error.status = response.status; error.code = data.error?.code; throw error; }
  return data;
}
function feedback(message) { const item = $('#toast-region'); item.textContent = message; setTimeout(() => { if (item.textContent === message) item.textContent = ''; }, 5000); }
function signIn(message = '') { if (state.eventSource) state.eventSource.close(); $('#app').hidden = true; $('#login').hidden = false; $('#login-error').hidden = !message; $('#login-error').textContent = message; }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }
function listItems(target, items) { const root = $(target); root.replaceChildren(); for (const item of items) root.append(node('li','',item)); }
function renderLesson(lesson) {
  $('#lesson-version').textContent = `v${lesson.version}`;
  $('#lesson-level').textContent = lesson.level;
  $('#reading-level').textContent = lesson.readingLevel;
  $('#safe-prompt').textContent = lesson.moderationExamples.safe[0];
  $('#unsafe-prompt').textContent = lesson.moderationExamples.outOfScope[0];
  $('#moderation-note').textContent = lesson.moderationExamples.handlingNote;
  $('#model-rule').textContent = lesson.simulation.formula;
  $('#lesson-objective').textContent = lesson.objective;
  $('#prompt-text').textContent = lesson.prompt;
  $('#source-title').textContent = `${lesson.source.publisher} · ${lesson.source.title}`;
  $('#source-checked').textContent = lesson.source.checked;
  $('#source-supports').textContent = lesson.source.supports;
  $('#source-link').href = lesson.source.url;
  listItems('#represents-list', lesson.whatItRepresents); listItems('#limits-list', lesson.whatItDoesNotRepresent);
  const demoChoice = $('#demo-choice'); demoChoice.replaceChildren();
  for (const choice of lesson.choices) { const option = document.createElement('option'); option.value = choice.number; option.textContent = `${choice.number} · ${choice.label}`; demoChoice.append(option); }
}
function phaseGuidance(snapshot) {
  if (snapshot.phase === 'ready') return 'The lesson is loaded. Open a prediction window when the overlay and audience are ready.';
  if (snapshot.phase === 'predict') return 'Viewers can make one numbered prediction. Close early if the stream is ready to continue; the timer is a guide, not a race.';
  if (snapshot.phase === 'choose') return snapshot.predictionResult === 'no-votes' ? 'No predictions this cycle. Choose any condition and continue neutrally.' : snapshot.predictionResult === 'tie' ? 'Predictions are tied. Pick one condition to test; neither side is marked wrong.' : 'The leading prediction is preselected. You can test another setting to compare the model.';
  if (snapshot.phase === 'reveal') return 'The model has calculated the selected condition. The answer stays hidden on stream until you reveal it.';
  if (snapshot.phase === 'learn') return 'Compare the prediction, the selected condition, and the rule-based result. The source and assumptions stay visible.';
  if (snapshot.phase === 'paused') return 'The lab is paused. Prediction time is preserved; resume when you are ready.';
  return 'This lab session has ended. Start a new local demo to run another lesson cycle.';
}
function buildPredictionList(snapshot) {
  const root = $('#prediction-list'); root.replaceChildren();
  for (const choice of snapshot.choices) {
    const row = node('div', `prediction-row${choice.id === snapshot.leadingChoiceId ? ' leading' : ''}`);
    row.append(node('span','option-number',choice.number));
    const copy = node('span',''); copy.append(node('span','prediction-label',choice.label),node('span','prediction-detail',`${choice.albedoPercent}% model reflectivity`));
    row.append(copy,node('strong','vote-count',String(choice.predictions))); root.append(row);
  }
  $('#prediction-total').textContent = String(snapshot.predictionTotal);
  $('#prediction-word').textContent = snapshot.predictionTotal === 1 ? 'prediction' : 'predictions';
  $('#sample-note').textContent = snapshot.predictionTotal < 5 ? 'Small participation sample · not a survey' : 'Aggregate only · no individual answers';
}
function buildParameterChoices(snapshot) {
  const root = $('#parameter-choices'); root.replaceChildren();
  for (const choice of snapshot.choices) {
    const label = node('label',`parameter-choice${snapshot.selectedChoiceId === choice.id ? ' selected' : ''}`); label.htmlFor = `test-${choice.id}`;
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'testChoice'; radio.id = `test-${choice.id}`; radio.value = choice.id; radio.checked = snapshot.selectedChoiceId === choice.id;
    const swatch = node('span','surface-chip'); swatch.style.backgroundColor = choice.swatch; swatch.setAttribute('aria-hidden','true');
    const title = node('strong','',choice.label); const meta = node('small','',`${choice.albedoPercent}% reflected · test this condition`);
    label.append(radio,swatch,title,meta); root.append(label);
  }
}
function renderResult(snapshot) {
  const result = snapshot.result; const root = $('#comparison-table'); root.replaceChildren(); if (!result) return;
  const selected = snapshot.choices.find((choice) => choice.id === snapshot.selectedChoiceId);
  $('#result-title').textContent = `Tested condition: ${selected?.label || 'selected surface'}`;
  $('#result-explanation').textContent = result.explanation;
  for (const rowData of result.comparison) {
    const row = node('div',`comparison-row${rowData.choiceId === snapshot.selectedChoiceId ? ' selected' : ''}`);
    row.append(node('span','option-number',rowData.number)); row.append(node('span','',`${rowData.label} · ${rowData.albedoPercent}% reflected`));
    row.append(node('strong','',`${rowData.absorbedEnergy} absorbed / ${rowData.incomingEnergy}`)); root.append(row);
  }
}
function renderSnapshot(snapshot) {
  state.session = snapshot; state.clockDeadline = performance.now() + (snapshot.timeRemainingMs || 0);
  $('#empty-state').hidden = true; $('#session-panel').hidden = false;
  $('#phase-index').textContent = snapshot.phaseLabel.toUpperCase(); $('#phase-tag').textContent = snapshot.phaseLabel.toUpperCase();
  $('#phase-tag').className = `state-tag${snapshot.phase === 'paused' ? ' paused' : snapshot.phase === 'learn' ? ' learned' : ''}`;
  $('#phase-guidance').textContent = phaseGuidance(snapshot);
  $('#prompt-text').textContent = snapshot.prompt;
  $('#prediction-quiet-note').hidden = snapshot.predictionTotal >= 5;
  buildPredictionList(snapshot);
  $('#parameter-fieldset').hidden = snapshot.phase !== 'choose';
  $('#selection-note').textContent = snapshot.predictionResult === 'no-votes' ? 'No one voted this cycle. Choose a condition without framing it as a failure.' : snapshot.predictionResult === 'tie' ? 'A tie is a neutral result. Select the condition the stream wants to inspect.' : `Leading prediction: ${snapshot.choices.find((choice) => choice.id === snapshot.leadingChoiceId)?.label || 'none'}. You may choose any condition.`;
  if (snapshot.phase === 'choose') buildParameterChoices(snapshot); else $('#parameter-choices').replaceChildren();
  $('#experiment-result').hidden = snapshot.phase !== 'learn'; if (snapshot.phase === 'learn') renderResult(snapshot);
  const primary = $('#primary-action'); const hint = $('#primary-hint'); let label = ''; let action = '';
  if (snapshot.phase === 'ready') { label = 'Start predictions'; action = 'start-predictions'; hint.textContent = 'Opens the numbered viewer choices for a short, fixed window.'; }
  else if (snapshot.phase === 'predict') { label = 'Close predictions'; action = 'close-predictions'; hint.textContent = 'Close when ready, or let the 90-second window end.'; }
  else if (snapshot.phase === 'choose') { label = 'Run experiment'; action = 'run-experiment'; hint.textContent = snapshot.selectedChoiceId ? 'Runs the finite, deterministic albedo rule.' : 'Choose a condition before running the model.'; }
  else if (snapshot.phase === 'reveal') { label = 'Reveal result'; action = 'reveal-result'; hint.textContent = 'Reveal the calculation, comparison, and source-backed explanation.'; }
  else if (snapshot.phase === 'learn') { label = 'Replay same seed'; action = 'replay'; hint.textContent = `Replay uses the same seed (${snapshot.seed || 'hidden'}); previous run notes remain.`; }
  else if (snapshot.phase === 'paused') { label = 'Resume'; action = 'resume'; hint.textContent = 'Resume the paused prediction or operator phase.'; }
  else { label = 'Start a new demo'; action = 'new-demo'; hint.textContent = 'A new session will use a new seed.'; }
  primary.textContent = label; primary.dataset.action = action; primary.append(node('span','button-arrow','→'));
  primary.disabled = snapshot.phase === 'choose' && !snapshot.selectedChoiceId;
  $('#pause-action').hidden = !['predict','choose','reveal'].includes(snapshot.phase);
  $('#pause-action').textContent = 'Pause';
  $('#pause-action').disabled = false;
  $('#reset-action').hidden = snapshot.phase === 'closed';
  $('#stop-action').hidden = ['closed','ready'].includes(snapshot.phase);
  $('#preview-demo').disabled = snapshot.phase !== 'closed';
  $('#demo-tools').hidden = snapshot.mode !== 'demo' || snapshot.phase !== 'predict';
  $('#connection-readiness').textContent = snapshot.mode === 'demo' ? 'Local demo · Twitch connection not configured' : 'Live connection not configured';
  $('#mode-badge').textContent = snapshot.mode === 'demo' ? 'DEMO · SIMULATION' : 'LIVE · NOT CONNECTED';
  $('#open-overlay').href = `/overlay?session=${encodeURIComponent(snapshot.sessionId)}`;
  state.overlayHref = $('#open-overlay').href; $('#overlay-preview').src = state.overlayHref;
  updateClock();
}
function updateClock() {
  if (!state.session) return;
  if (state.session.phase !== 'predict' && state.session.phase !== 'paused') { $('#round-clock').textContent = state.session.phase === 'choose' ? 'PREDICTIONS CLOSED' : state.session.phase === 'reveal' ? 'READY TO REVEAL' : '—'; return; }
  const seconds = Math.max(0, Math.ceil((state.clockDeadline - performance.now()) / 1000));
  $('#round-clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`;
}
function connectStream() {
  if (state.eventSource) state.eventSource.close(); if (!state.session) return;
  state.eventSource = new EventSource(`/api/studio/${encodeURIComponent(state.session.sessionId)}/events`);
  state.eventSource.addEventListener('snapshot', (event) => { try { renderSnapshot(JSON.parse(event.data).snapshot); } catch {} });
  state.eventSource.onerror = () => { $('#connection-readiness').textContent = 'Studio stream reconnecting · current controls remain server-checked'; };
}
function renderRecap(runs) {
  const root = $('#recap-list'); root.replaceChildren(); if (!runs.length) { root.append(node('p','empty-copy','Completed reveals appear here with the audience prediction, selected condition, model output, assumptions, and citation.')); return; }
  for (const run of [...runs].reverse()) {
    const card = node('article','recap-card'); const header = node('header');
    header.append(node('h3','',`Run ${run.cycle} · ${run.lessonId} v${run.lessonVersion}`),node('span','run-meta',new Date(run.revealedAt).toLocaleString())); card.append(header);
    const tested = run.testedParameter?.label || 'No selected condition'; const result = run.result?.tested;
    card.append(node('p','recap-question',`Question: ${run.question}`));
    card.append(node('p','',`Prediction sample: ${run.predictionTotal}. ${run.leadingPrediction ? `Leading prediction: ${run.leadingPrediction.label}.` : run.predictionOutcome === 'tie' ? 'Prediction was tied.' : 'No predictions were submitted.'} Tested: ${tested}.`));
    const metrics = node('div','recap-result');
    const cells = [['INCOMING',result ? `${result.incomingEnergy} model units` : '—'],['ABSORBED',result ? `${result.absorbedEnergy} units` : '—'],['REFLECTED',result ? `${result.reflectedEnergy} units` : '—']];
    for (const [label,value] of cells) { const m=node('div','recap-metric'); m.append(node('span','',label),node('strong','',value)); metrics.append(m); } card.append(metrics);
    card.append(node('p','',run.result?.explanation || 'No result details recorded.'));
    const notes=node('details','recap-notes');notes.append(node('summary','',`Model rule & assumptions · ${run.simulation.id}`));
    notes.append(node('p','recap-formula',`${run.simulation.formula} (${run.simulation.unit})`));
    const assumptionList=node('ul','');for(const assumption of run.assumptions)assumptionList.append(node('li','',assumption));notes.append(assumptionList);card.append(notes);
    const source = node('a','',`${run.source.publisher} · ${run.source.title} ↗`); source.href = run.source.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; card.append(source);
    card.append(node('p','source-supports',run.source.supports));
    root.append(card);
  }
}
async function refresh() {
  try {
    state.config = await api('/api/studio'); renderLesson(state.config.lesson); showApp();
    const current = state.config.session; if (current) { renderSnapshot(current); connectStream(); } else { state.session = null; $('#empty-state').hidden = false; $('#session-panel').hidden = true; $('#preview-demo').disabled = false; $('#overlay-preview').src = '/overlay?preview=1'; $('#open-overlay').href = '/overlay?preview=1'; $('#mode-badge').textContent = 'DEMO · SIMULATION'; }
    renderRecap((await api('/api/recap')).runs);
  } catch (error) { if (error.status === 401) signIn(); else signIn(error.message); }
}
async function startDemo() {
  try {
    const result = await api('/api/sessions',{method:'POST',body:JSON.stringify({mode:'demo'})});
    const sessionId = result.snapshot.sessionId;
    const started = await api(`/api/sessions/${sessionId}/start-predictions`,{method:'POST',body:JSON.stringify({})});
    renderSnapshot(started.snapshot); connectStream(); renderRecap((await api('/api/recap')).runs); feedback('Demo prediction window is open. Fixture input is clearly labelled; this is not Twitch chat.');
  } catch (error) { feedback(error.message); }
}
async function sessionAction(action, body = {}) {
  if (!state.session && action !== 'new-demo') return;
  if (action === 'new-demo') return startDemo();
  const id = state.session.sessionId;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(id)}/${action}`,{method:'POST',body:JSON.stringify(body)});
    if (result.snapshot) renderSnapshot(result.snapshot);
    renderRecap((await api('/api/recap')).runs);
    if (action === 'replay') feedback('Same-seed replay is ready. Start predictions when you want the next run.');
    if (action === 'reset') feedback('Session reset. Earlier revealed runs remain in the recap.');
    if (action === 'end') feedback('Session ended. Aggregate run notes remain for 24 hours.');
  } catch (error) { feedback(error.message); }
}
function confirmAction(action) {
  state.pendingConfirm = action;
  $('#confirm-title').textContent = action === 'reset' ? 'Reset the current run?' : 'End this session?';
  $('#confirm-copy').textContent = action === 'reset' ? 'Votes and any unrevealed calculation will clear. Earlier reveals remain in the recap.' : 'The current prediction cycle will stop accepting votes. Earlier reveals remain available for 24 hours.';
  $('#confirm-reset').textContent = action === 'reset' ? 'Reset to ready' : 'End session';
  $('#confirm-dialog').showModal();
}
$('#login-form').addEventListener('submit',async(event)=>{event.preventDefault();try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({passcode:$('#passcode').value})});$('#passcode').value='';await refresh();}catch(error){signIn(error.message);}});
$('#sign-out').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:JSON.stringify({})});}catch{}signIn();});
$('#preview-demo').addEventListener('click',()=>void startDemo()); $('#start-demo').addEventListener('click',()=>void startDemo());
$('#primary-action').addEventListener('click',()=>void sessionAction($('#primary-action').dataset.action));
$('#pause-action').addEventListener('click',()=>void sessionAction(state.session?.phase==='paused'?'resume':'pause'));
$('#reset-action').addEventListener('click',()=>confirmAction('reset')); $('#stop-action').addEventListener('click',()=>confirmAction('end'));
$('#confirm-dialog').addEventListener('close',()=>{if($('#confirm-dialog').returnValue==='confirm'&&state.pendingConfirm)void sessionAction(state.pendingConfirm);state.pendingConfirm=null;});
$('#parameter-choices').addEventListener('change',(event)=>{if(event.target.matches('input[name="testChoice"]'))void sessionAction('select-parameter',{choiceId:event.target.value});});
$('#add-sample-vote').addEventListener('click',async()=>{if(!state.session)return;try{const result=await api(`/api/sessions/${state.session.sessionId}/demo-vote`,{method:'POST',body:JSON.stringify({voterId:$('#demo-voter').value,choiceNumber:$('#demo-choice').value})});renderSnapshot(result.snapshot);$('#demo-feedback').textContent=result.accepted?'Simulated prediction recorded; not a chat event.':`Not counted: ${result.reason}.`; }catch(error){$('#demo-feedback').textContent=error.message;}});
setInterval(updateClock,250);
async function boot(){const status=await api('/api/auth/status');if(status.authenticated)await refresh();else signIn();}
boot().catch((error)=>signIn(error.message));
