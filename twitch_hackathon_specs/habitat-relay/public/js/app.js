const root = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const query = new URLSearchParams(location.search);
const overlayMode = query.get('view') === 'overlay';
const isPreview = query.get('preview') === '1';
const oauthMessages = {
  OAUTH_DENIED: 'Twitch authorization was cancelled. Nothing changed; you can try again or stay in demo mode.',
  INVALID_STATE: 'The Twitch sign-in could not be verified. Start the connection again from this app.',
  INVALID_CODE: 'Twitch did not return a valid sign-in code. Start the connection again.',
  TOKEN_EXCHANGE_FAILED: 'Twitch sign-in failed. Check the registered redirect URI and app credentials.',
  TOKEN_INVALID: 'The Twitch access token was rejected. Reconnect the account.',
  MISSING_SCOPE: 'The account did not grant user:read:chat. Reconnect and approve the requested permission.',
  USER_LOOKUP_FAILED: 'Twitch sign-in worked, but the broadcaster account could not be verified.',
  REFRESH_FAILED: 'Twitch could not refresh this account. Reconnect it to continue.',
  SUBSCRIPTION_FAILED: 'The Twitch account connected, but chat subscription setup failed. Check channel authorization and reconnect.',
  NOT_CONFIGURED: 'Twitch is not configured on this server. Demo mode remains available.',
  CONNECT_FAILED: 'Twitch could not connect. Check the app setup and try again.',
};
const oauthMessage = oauthMessages[query.get('twitch_error')] ?? '';
let state = null;
let content = null;
let twitch = { configured: false, connected: false, ready: false, profile: null, error: null };
let operatorStatus = { canUndoLastChoice: false };
let eventLog = [];
let liveConfirmed = false;
let lastConfirmedChannelId = null;
let eventRefreshTimer = null;
let displayRemainingMs = null;
let clockReceivedAt = 0;
let sessionElapsedMs = 0;
let elapsedReceivedAt = 0;
let lastRevision = -1;
let overlayUrl = null;
let lastSessionId = null;
let overlayRevoked = false;
let lastMessage = '';
let toastTimer = null;
let eventSource;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmtTime = (ms) => {
  if (!Number.isFinite(ms)) return '--:--';
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const fmtElapsed = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const currentRemainingMs = () => state?.phase === 'voting' && Number.isFinite(displayRemainingMs)
  ? Math.max(0, displayRemainingMs - (performance.now() - clockReceivedAt))
  : state?.phase === 'paused' ? Math.max(0, state.remainingMs ?? 0) : null;
const currentSessionElapsedMs = () => sessionElapsedMs + Math.max(0, performance.now() - elapsedReceivedAt);
function syncClock(snapshot) {
  displayRemainingMs = snapshot.remainingMs;
  sessionElapsedMs = snapshot.sessionElapsedMs ?? sessionElapsedMs;
  clockReceivedAt = elapsedReceivedAt = performance.now();
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) throw new Error(body?.message ?? `Request failed (${response.status}).`);
  return body;
}

function notify(message) {
  toastNode.textContent = message;
  toastNode.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('visible'), 3200);
}

function overlayHref(preview = false) {
  if (!overlayUrl) return `/?view=overlay${preview ? '&preview=1' : ''}`;
  const link = new URL(overlayUrl, location.origin);
  if (preview) link.searchParams.set('preview', '1');
  return `${link.pathname}${link.search}`;
}
async function refreshOverlayUrl() {
  if (overlayMode) return;
  try {
    const result = await request('/api/operator/overlay-link');
    overlayUrl = result.url;
    lastSessionId = result.sessionId;
  } catch { /* overlay link tools remain unavailable if the local control API is down */ }
}
function sourceById(id) {
  return content?.sources?.find((source) => source.id === id) ?? content?.sources?.[0] ?? null;
}
function currentSource() {
  const id = state?.round?.sourceId ?? state?.history?.at(-1)?.sourceId;
  return sourceById(id);
}

function sceneSvg(metrics, compact = false) {
  const forage = metrics?.forage ?? 26;
  const nesting = metrics?.nesting ?? 20;
  const links = metrics?.connectivity ?? 18;
  const flowersOpacity = Math.max(.28, Math.min(1, forage / 78));
  const nestOpacity = Math.max(.28, Math.min(1, nesting / 70));
  const pathOpacity = Math.max(.2, Math.min(.9, links / 70));
  return `<svg viewBox="0 0 780 360" role="img" aria-label="Illustrated habitat: ${Math.round(forage)} forage, ${Math.round(nesting)} nesting, ${Math.round(links)} habitat links. These are simulation indicators, not ecological measurements." xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b8c9a0"/><stop offset="1" stop-color="#d9d4a9"/></linearGradient><linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#66855d"/><stop offset="1" stop-color="#3c684b"/></linearGradient></defs>
  <rect width="780" height="360" fill="url(#sky)"/>
  <circle cx="630" cy="82" r="39" fill="#efd890" opacity=".87"/>
  <path d="M0 173 C112 131 190 174 286 139 C395 98 489 153 585 126 C665 104 724 127 780 105 L780 360 L0 360Z" fill="#75906a"/>
  <path d="M0 221 C99 178 205 220 301 182 C430 130 491 205 612 167 C697 140 742 172 780 160 L780 360 L0 360Z" fill="url(#land)"/>
  <path d="M0 275 C121 239 217 273 317 244 C455 203 563 246 780 203 L780 360 L0 360Z" fill="#315a43"/>
  <path d="M0 300 C128 271 210 304 318 273 C440 239 563 274 780 234" fill="none" stroke="#c6bd87" stroke-width="3" stroke-dasharray="8 10" opacity="${pathOpacity}"/>
  <g opacity="${flowersOpacity}" fill="#f2e4a8" stroke="#f2e4a8">${[[98,257],[153,226],[204,277],[270,238],[448,250],[514,219],[611,253],[697,226]].map(([x,y])=>`<path d="M${x} ${y+18}v-20" stroke="#d8d19d" stroke-width="2"/><circle cx="${x}" cy="${y-7}" r="5"/><circle cx="${x-7}" cy="${y}" r="4"/><circle cx="${x+7}" cy="${y}" r="4"/><circle cx="${x}" cy="${y+7}" r="4"/><circle cx="${x}" cy="${y}" r="2.8" fill="#bf843e" stroke="none"/>`).join('')}</g>
  <g opacity="${nestOpacity}"><path d="M553 207 L569 111 Q576 91 589 110 L608 203" fill="#634b36"/><path d="M568 111 Q593 128 618 104 Q604 136 576 137Z" fill="#446443"/><path d="M583 192 Q606 179 625 191 L625 201 L581 201Z" fill="#67513b"/><circle cx="599" cy="192" r="4" fill="#d8c8a0"/></g>
  <g fill="#edd17d"><ellipse cx="356" cy="200" rx="8" ry="5"/><ellipse cx="365" cy="200" rx="5" ry="4" fill="#292d25"/><path d="M357 195 Q353 188 349 193 M363 195 Q367 188 371 193" fill="none" stroke="#f3ead3" stroke-width="2"/></g>
  <path d="M352 207 Q365 213 376 207" fill="none" stroke="#f3ead3" stroke-width="1" opacity=".7"/>
  </svg>`;
}

function header() {
  const profile = twitch.profile?.displayName ?? twitch.profile?.login;
  const connClass = twitch.ready ? 'ready' : twitch.connected ? 'warn' : '';
  const connText = twitch.ready ? `Connected · ${esc(profile)}` : twitch.error ? `Connection issue · ${esc(twitch.error)}` : twitch.connected ? 'Connecting to chat' : 'Twitch not connected';
  const lastEvent = twitch.lastDeliveryAt ? `Last event ${fmtElapsed(Date.now() - twitch.lastDeliveryAt)} ago` : 'Waiting for first chat event';
  const mode = state?.mode ?? 'demo';
  return `<header class="topbar">
    <a href="/" class="brand" aria-label="Habitat Relay home"><span class="brand-mark" aria-hidden="true">H</span><span class="brand-copy"><strong>Habitat Relay</strong><span>Field station / Pollinator corridor</span></span></a>
    <div class="top-right"><span class="mode-pill ${mode}">${mode === 'demo' ? 'Demo session' : 'Live channel'}</span><span class="conn-pill ${connClass}" aria-live="polite" title="${esc(twitch.error ?? (twitch.ready ? lastEvent : twitch.transport ?? 'Not connected'))}">${connText}</span><span class="session-time">Session <strong id="session-elapsed">${fmtElapsed(currentSessionElapsedMs())}</strong></span><a class="top-link" href="${esc(overlayHref(true))}" target="_blank" rel="noopener">Open overlay preview ↗</a><button class="top-link copy-link" type="button" data-copy-overlay>Copy OBS URL</button></div>
  </header>`;
}

function scenePanel() {
  const round = state?.round;
  const eyebrow = round?.eyebrow ?? (state.phase === 'complete' ? 'FIELD NOTES / SESSION COMPLETE' : 'FIELD NOTES / READY TO BEGIN');
  const title = round?.title ?? 'A landscape shaped together';
  const showSceneTitle = state.phase === 'ready' || state.phase === 'complete';
  return `<section class="panel habitat-panel" aria-label="Simulated habitat illustration">
    <div class="habitat-head"><div><div class="eyebrow">${esc(eyebrow)}</div>${showSceneTitle ? `<h2 class="habitat-title">${esc(title)}</h2>` : ''}</div><span class="habitat-kicker">Simulation · ${state.history.length + (state.skippedRounds?.length ?? 0)}/${state.totalRounds} stops</span></div>
    <div class="scene">${sceneSvg(state.metrics)}</div>
    <div class="scene-label">An authored landscape · not a field measurement</div>
    <div class="scene-legend" aria-hidden="true"><span><i class="legend-dot"></i> Forage</span><span><i class="legend-dot blue"></i> Habitat links</span></div>
  </section>`;
}

function resourceBudgetPanel() {
  return `<div class="resource-budget"><span class="resource-label">Fictional field tokens <span>game-only · not money or materials</span></span><strong>${state.resourceBudget} <small>/ ${state.resourceBudgetMax} left</small></strong></div>`;
}

function metricsPanel() {
  const metricEntries = Object.entries(content?.metrics ?? { forage: 'Seasonal forage', nesting: 'Nesting places', connectivity: 'Habitat links', diversity: 'Habitat variety', resilience: 'Landscape resilience' });
  return `<section class="panel metrics-panel" aria-labelledby="metrics-heading">
    <div class="section-head"><h2 id="metrics-heading">The landscape, so far</h2><span class="microcopy">Scenario indicators · 0–100</span></div>
    <div class="metrics-grid">${metricEntries.map(([key,label])=>`<div class="metric"><div class="metric-top"><span class="metric-label">${esc(label)}</span><span class="metric-value">${Math.round(state.metrics[key] ?? 0)}</span></div><div class="meter" role="meter" aria-label="${esc(label)} in simulation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(state.metrics[key] ?? 0)}"><div class="meter-fill" style="width:${Math.max(0,Math.min(100,state.metrics[key] ?? 0))}%"></div></div></div>`).join('')}</div>
    <p class="metric-disclaimer">These values are authored game state—not ecological measurements, forecasts, or evidence of real-world restoration.</p>${resourceBudgetPanel()}
  </section>`;
}

function renderOption(option, index, totalVotes, selected = false) {
  const votes = state.votes?.[option.id] ?? 0;
  const percent = totalVotes ? Math.round(votes / totalVotes * 100) : 0;
  const inactive = state.phase !== 'voting';
  const demoVote = state.mode === 'demo' && state.phase === 'voting';
  const isReview = state.phase === 'review';
  return `<button type="button" class="option-card ${selected ? 'selected' : ''}" data-${isReview ? 'select-choice' : 'vote-option'}="${esc(option.id)}" ${(!demoVote && !isReview) || (inactive && !isReview) ? 'disabled' : ''} aria-pressed="${selected ? 'true' : 'false'}">
    <span class="option-number">${String(index+1).padStart(2,'0')}</span><span class="option-copy"><strong>${esc(option.label)}</strong><span>${esc(option.description)}</span><span class="option-cost">Costs ${option.cost} fictional field token${option.cost === 1 ? '' : 's'} · game-only</span></span>
    ${state.phase === 'voting' || isReview ? `<span class="vote-row" aria-label="${votes} votes, ${percent} percent"><span class="vote-track"><span class="vote-fill" style="width:${percent}%"></span></span><span class="vote-count">${votes} · ${percent}%</span></span>` : ''}
  </button>`;
}

function roundPanel() {
  const round = state.round;
  if (state.phase === 'ready') return `<section class="panel setup-card"><div class="setup-layout"><div><div class="eyebrow">CONNECT → PREVIEW → START</div><h2>Give chat a hand in shaping the habitat.</h2><p>Three rounds. Chat votes on two options each; you approve every change to this illustrated habitat.</p><p><strong>Game-only:</strong> indicators are illustrative—not scientific measurements or real restoration.</p><div class="setup-step"><span class="setup-step-number">01</span><div><strong>Connect a channel (optional)</strong><p>Demo works offline. Live mode reads the connected broadcaster’s chat.</p></div></div>${twitch.connected && twitch.profile ? `<div class="channel-confirm"><span class="connection-indicator ${twitch.ready ? 'ready' : 'warn'}" aria-hidden="true"></span><div><strong>Selected channel: ${esc(twitch.profile.displayName)} <span class="channel-login">@${esc(twitch.profile.login)}</span></strong><p>${twitch.ready ? 'EventSub chat connection is ready.' : esc(twitch.error ?? 'Waiting for the chat connection to become ready.')}</p></div><label class="channel-confirm-check"><input id="confirm-live-channel" type="checkbox" ${liveConfirmed && lastConfirmedChannelId === twitch.profile.id ? 'checked' : ''}><span>I confirm this is the channel I want to run live.</span></label><a class="text-action" href="/auth/twitch">Switch account</a><button class="text-action" type="button" data-twitch-action="disconnect">Disconnect</button></div>` : twitch.configured ? `<a class="button button-secondary" href="/auth/twitch">${twitch.error ? 'Reconnect Twitch' : 'Connect Twitch'}</a>` : `<div class="state-banner">Live chat is optional. Add Twitch app credentials and an encryption key in <code>.env</code> to enable it.</div>`}${twitch.error ? `<div class="state-banner error" role="status">${esc(twitch.error)} ${twitch.configured ? 'Reconnect the account or continue in demo mode.' : 'Check the Twitch setup in README.md.'}</div>` : ''}${oauthMessage ? `<div class="state-banner error" role="status">${esc(oauthMessage)}</div>` : ''}<div class="setup-step"><span class="setup-step-number">02</span><div><strong>Preview the broadcast view</strong></div><a class="text-action" href="${esc(overlayHref(true))}" target="_blank" rel="noopener">Preview overlay ↗</a></div><div class="setup-step"><span class="setup-step-number">03</span><div><strong>Choose how to start</strong></div></div>${resourceBudgetPanel()}<div class="setup-actions"><button class="button button-primary" data-command="start" data-mode="demo">Try without Twitch <span aria-hidden="true">→</span></button>${twitch.ready ? `<button class="button button-secondary" data-command="start" data-mode="live" ${!liveConfirmed || lastConfirmedChannelId !== twitch.profile?.id ? 'disabled title="Confirm the connected channel first"' : ''}>Start live on ${esc(twitch.profile?.login ?? 'Twitch')}</button>` : ''}</div></div><div class="setup-art" aria-hidden="true"><span class="setup-art-mark">H</span></div></div></section>`;
  if (state.phase === 'complete') {
    const route = (content?.rounds ?? []).map((round,index) => {
      const entry = state.history.find((item) => item.roundId === round.id);
      const skipped = state.skippedRounds?.find((item) => item.roundId === round.id);
      const label = entry ? entry.choiceLabel : skipped ? 'Round discarded' : 'Not reached';
      const detail = entry ? `${entry.note} Used ${entry.resourceCost ?? 0} fictional token${entry.resourceCost === 1 ? '' : 's'}; ${entry.budgetAfter ?? state.resourceBudget} remain.` : skipped ? `${skipped.voteTotal} aggregate votes were discarded; no habitat effects were applied.` : 'This round was not played.';
      return `<div class="option-card route-result ${skipped ? 'discarded' : ''}"><span class="option-number">0${index+1}</span><span class="option-copy"><strong>${esc(label)}</strong><span>${esc(detail)}</span></span></div>`;
    }).join('');
    const action = content?.actions?.find((item) => item.optional) ?? null;
    return `<section class="panel round-panel"><div class="round-label"><span class="eyebrow">THREE ROUNDS · ONE SHARED LANDSCAPE</span><span class="timer">Complete</span></div><h2>Field notes from this run</h2><p class="round-prompt">The illustration tells the story of the choices the community made. This is a game simulation—not a measured ecological outcome.</p><div class="option-list">${route}</div><div class="final-action"><div class="eyebrow">OPTIONAL · OUTSIDE THE GAME</div><h3>${esc(action?.title ?? 'Take a small next step')}</h3><p>${esc(action?.description ?? 'Explore a locally appropriate action if it suits you.')}</p>${action ? `<a class="button button-secondary" href="/action/${encodeURIComponent(action.id)}" target="_blank" rel="noopener noreferrer">${esc(action.label)} ↗</a><span class="action-source">${esc(action.publisher)} · link checked ${esc(action.checked)}. No purchase or pledge required.</span>` : ''}</div><div class="round-controls"><a class="button button-secondary" href="/api/recap?format=markdown">Download Markdown recap</a><a class="button button-secondary" href="/api/recap">Download JSON recap</a><button class="button button-primary" data-command="reset" data-mode="${state.mode}">Start another session</button></div><div class="state-banner">Simulation, not measured restoration. Recaps contain aggregate participation only. ${state.mode === 'demo' ? 'Demo data was used.' : 'The session used Twitch chat.'}</div></section>`;
  }
  if (state.phase === 'paused') {
    const fromReview = state.pausedFrom === 'review';
    const canResume = state.mode !== 'live' || twitch.ready;
    const pauseReason = state.mode === 'live' && !twitch.ready ? 'Twitch is disconnected or reconnecting. The server paused the round and froze its clock; reconnect before resuming.' : 'Paused by the streamer. The overlay is showing the same state.';
    return `<section class="panel round-panel"><div class="round-label"><span class="eyebrow">SESSION PAUSED · ${esc(round?.eyebrow ?? '')}</span><span class="timer">${fromReview ? 'Review held' : fmtTime(state.remainingMs)}</span></div><h2 id="round-title">${esc(round?.title ?? 'The field is at rest.')}</h2><p class="round-prompt">${fromReview ? 'The closed round is waiting for your choice. Resume to review and commit it.' : 'The round timer is frozen. Chat cannot add votes until you resume.'}</p><div class="state-banner warn" role="status">${esc(pauseReason)}</div><div class="round-controls"><button class="button button-primary" data-command="resume" ${canResume ? '' : 'disabled'}>Resume session</button><button class="button button-danger" data-command="reset" data-mode="${state.mode}">Reset session</button></div></section>`;
  }
  if (!round) return '<section class="panel round-panel"><p>No active round.</p></section>';
  const total = state.voteTotal ?? 0;
  const isReview = state.phase === 'review';
  const hint = state.mode === 'live' ? 'Chat votes with !habitat 1 or !habitat 2. One vote per viewer per round.' : 'Demo mode: add sample audience votes or cast one test vote below.';
  const options = round.options.map((option,index)=>renderOption(option,index,total,isReview && option.id===state.pendingChoiceId)).join('');
  const controls = isReview
    ? `<div class="state-banner ${state.voteOutcome === 'tie' || state.voteOutcome === 'no-votes' ? 'warn' : ''}">${state.voteOutcome === 'tie' ? 'The round is tied. Select the streamer’s choice, then commit it.' : state.voteOutcome === 'no-votes' ? 'No votes arrived. Choose a path for the demo, or reset.' : `Audience plurality: ${esc(round.options.find(o=>o.id===state.pendingChoiceId)?.shortLabel ?? '')}. Review and approve to continue.`}</div><div class="round-controls"><button class="button button-primary" data-command="approve-choice" ${!state.pendingChoiceId ? 'disabled' : ''}>Commit choice & continue</button><button class="button button-secondary" data-command="pause">Pause review</button><button class="button button-danger" data-command="discard-round">Discard round</button></div>`
    : `<div class="round-controls">${state.mode === 'demo' ? `<button class="button button-secondary" data-command="sample-votes" data-sample-counts="4,3">Add sample audience</button><button class="button button-quiet" data-command="sample-votes" data-sample-counts="3,3">Rehearse a tie</button>` : ''}<button class="button button-primary" data-command="close-round">Close round & review</button><button class="button button-quiet" data-command="pause" aria-label="Pause session">Pause</button><button class="button button-danger" data-command="discard-round">Discard round</button></div><p class="hint">${esc(hint)}</p>`;
  return `<section class="panel round-panel" aria-labelledby="round-title"><div class="round-label"><span class="eyebrow">${esc(round.eyebrow)} · ${isReview ? 'STREAMER REVIEW' : 'CHAT VOTING'}</span><span class="timer" id="timer">${isReview ? 'Review' : fmtTime(currentRemainingMs())}</span></div><h2 id="round-title">${esc(round.title)}</h2><p class="round-prompt">${esc(round.prompt)}</p><div class="option-list">${options}</div>${controls}</section>`;
}

function sourcePanel() {
  const source = currentSource();
  if (!source) return '';
  return `<section class="panel source-panel" aria-labelledby="source-heading"><div class="source-top"><div class="source-heading"><span class="source-icon" aria-hidden="true">✳</span><div><div class="eyebrow">FIELD NOTE / SOURCE</div><h2 id="source-heading">Evidence behind the scenario</h2></div></div></div><p class="source-text">${esc(source.supports)}</p><div class="source-meta">${esc(source.publisher)} · ${source.published ? `Published ${esc(source.published)}` : 'Reference page'} · checked ${esc(source.checked)}</div><div class="source-foot"><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Read the source ↗</a><span>Source informs scenario design; it does not validate game scores.</span></div></section>`;
}

function connectionPanel() {
  if (!twitch.configured && !twitch.connected && !twitch.error && state.mode !== 'live') return '';
  const profile = twitch.profile;
  const statusText = twitch.ready ? `Ready · ${profile?.displayName ?? profile?.login ?? 'Twitch channel'}` : twitch.error ? 'Attention needed' : twitch.connected ? 'Connecting · votes are paused until ready' : 'Disconnected';
  const lastEvent = twitch.lastDeliveryAt ? `Last chat event ${fmtElapsed(Date.now() - twitch.lastDeliveryAt)} ago` : 'Waiting for the first accepted chat event';
  return `<section class="panel connection-panel" aria-labelledby="connection-heading"><div class="activity-head"><h2 id="connection-heading">Connection health</h2><span class="connection-state ${twitch.ready ? 'ready' : 'warn'}">${esc(statusText)}</span></div><p>${profile ? `Authorized broadcaster: <strong>${esc(profile.displayName)}</strong> <span class="channel-login">@${esc(profile.login)}</span>` : 'The local demo can run without a Twitch connection.'}</p><p class="connection-last-event">${twitch.ready ? esc(lastEvent) : esc(twitch.error ?? 'Live votes are unavailable until chat is ready.')}</p>${twitch.error ? `<div class="state-banner error" role="status">${esc(twitch.error)}</div>` : ''}<div class="connection-actions">${twitch.connected ? `<a class="text-action" href="/auth/twitch">Reconnect / switch account</a><button class="text-action" data-twitch-action="disconnect">Disconnect account</button>` : twitch.configured ? `<a class="text-action" href="/auth/twitch">Connect Twitch</a>` : `<span class="microcopy">Configure Twitch in .env for live mode.</span>`}</div></section>`;
}

function journeyPanel() {
  const rounds = content?.rounds ?? [];
  const skippedIds = new Set((state.skippedRounds ?? []).map((item) => item.roundId));
  const completedIds = new Set(state.history.map((item) => item.roundId));
  return `<section class="panel progress-panel"><div class="section-head"><h2>Today’s field route</h2><span class="microcopy">3 decisions</span></div><div class="journey">${rounds.map((round,index)=>`<div class="journey-step ${completedIds.has(round.id) ? 'done' : ''} ${skippedIds.has(round.id) ? 'skipped' : ''} ${index === state.roundIndex && state.phase !== 'complete' ? 'active' : ''}"><span class="journey-number">0${index+1} / FIELD STOP · ${skippedIds.has(round.id) ? 'SKIPPED' : completedIds.has(round.id) ? 'DONE' : index === state.roundIndex ? 'NOW' : 'NEXT'}</span><strong>${esc(round.title)}</strong></div>`).join('')}</div></section>`;
}

function eventPanel() {
  const list = eventLog.slice(-7).reverse();
  const description = (event) => {
    const payload = event.payload ?? {};
    const round = (content?.rounds ?? []).find((item) => item.id === payload.roundId);
    const option = round?.options?.find((item) => item.id === payload.optionId || item.id === payload.choiceId);
    const eventNames = {
      'session-created': 'Session created', 'session-started': 'Session started', 'session-reset': 'Session reset',
      'session-paused': 'Session paused', 'session-resumed': 'Session resumed', 'round-closed': 'Round closed',
      'vote-accepted': 'Vote accepted', 'choice-selected': 'Streamer choice selected', 'choice-committed': 'Choice committed',
      'choice-undone': 'Choice returned to review', 'round-discarded': 'Round discarded', 'final-action-viewed': 'Optional action opened', 'vote-rejected': 'Vote command not counted',
    };
    let text = eventNames[event.type] ?? 'Session event';
    if (event.type === 'vote-accepted' && option) text = `Aggregate ballot for ${option.shortLabel}`;
    else if (event.type === 'choice-committed' && option) text = `Committed: ${option.shortLabel} · ${payload.resourceCost ?? 0} fictional token${payload.resourceCost === 1 ? '' : 's'} used`;
    else if (event.type === 'choice-undone' && option) text = `Returned ${option.shortLabel} to review`;
    else if (event.type === 'round-discarded' && round) text = `Stop ${round.number} discarded; no effects applied`;
    else if (event.type === 'final-action-viewed') text = 'Optional resource opened (aggregate only)';
    else if (event.type === 'vote-rejected') text = `Vote command not counted · ${String(payload.reason ?? 'invalid').replaceAll('-', ' ')}`;
    else if (event.type === 'round-closed') text = `Voting closed · ${String(payload.outcome ?? 'review').replace('-', ' ')}`;
    return text;
  };
  return `<section class="panel activity-panel"><div class="activity-head"><h2>Session activity</h2><span class="microcopy">Private · no chat names or text</span></div><div class="activity-list" aria-label="Recent session events" role="log" aria-live="off" tabindex="0">${list.length ? list.map((event)=>`<div class="activity-item"><i class="activity-mark" aria-hidden="true"></i><span>${esc(description(event))}</span><time datetime="${new Date(event.createdAt).toISOString()}">${new Date(event.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>`).join('') : '<p class="microcopy">The field station is ready for its first session.</p>'}</div></section>`;
}

function renderStudio() {
  if (!state) return;
  const focused = document.activeElement?.dataset?.command ? `command:${document.activeElement.dataset.command}` : document.activeElement?.dataset?.voteOption ? `vote:${document.activeElement.dataset.voteOption}` : document.activeElement?.dataset?.selectChoice ? `select:${document.activeElement.dataset.selectChoice}` : null;
  const layout = state.phase === 'ready'
    ? `<div class="ready-layout">${roundPanel()}<div class="ready-support">${scenePanel()}${sourcePanel()}</div>${journeyPanel()}${eventPanel()}</div>`
    : `<div class="layout"><div class="main-column">${scenePanel()}${metricsPanel()}${journeyPanel()}</div><aside class="side-column">${connectionPanel()}${roundPanel()}${sourcePanel()}${eventPanel()}</aside></div>`;
  root.innerHTML = `<div class="shell ${state.phase === 'ready' ? 'ready' : ''}">${header()}<section class="hero"><div><div class="eyebrow">A SHARED EXPERIENCE FOR STREAMERS & CHAT</div><h1>A living landscape,${state.phase === 'ready' ? ' ' : '<br>'}<em>built together.</em></h1><p>${state.phase === 'ready' ? 'Three choices shape one illustrated habitat. You approve every change.' : 'Three small choices. One changing habitat. Your chat helps shape a hopeful pollinator corridor—one streamer-approved step at a time.'}</p></div><div class="hero-actions"><a class="button button-secondary" href="${esc(overlayHref(true))}" target="_blank" rel="noopener">Preview OBS overlay ↗</a><button class="button button-quiet" type="button" data-copy-overlay>Copy OBS URL</button>${operatorStatus.canUndoLastChoice ? `<button class="button button-secondary" data-command="undo-last-choice">Undo last committed choice</button>` : ''}${state.phase !== 'ready' ? `<button class="button button-danger" data-command="reset" data-mode="${state.mode}">Reset session</button>` : ''}</div></section>
    ${layout}
    <footer class="footnote"><span>Habitat Relay · Pollinator corridor scenario <span aria-hidden="true">·</span> ${esc(state.scenarioVersion)}</span><span>Illustrative simulation only. <a href="https://www.eea.europa.eu/en/analysis/publications/protecting-and-restoring-europes-wild-pollinators-and-their-habitats" target="_blank" rel="noopener">Read the EEA briefing ↗</a></span></footer></div>`;
  if (focused) {
    const [kind,value] = focused.split(':');
    const attr = kind === 'command' ? 'command' : kind === 'vote' ? 'vote-option' : 'select-choice';
    const target = [...root.querySelectorAll(`[data-${attr}]`)].find((node)=>node.dataset[kind === 'command' ? 'command' : kind === 'vote' ? 'voteOption' : 'selectChoice'] === value);
    target?.focus({preventScroll:true});
  }
}

function renderOverlay() {
  document.body.classList.add('overlay-mode');
  root.className = isPreview ? 'overlay-wrap overlay-preview' : 'overlay-wrap';
  if (!state) { root.innerHTML = '<div class="overlay-card"><p>Connecting to the field station…</p></div>'; return; }
  const round = state.round;
  const source = currentSource();
  const complete = state.phase === 'complete';
  const title = round?.title ?? (complete ? 'A landscape shaped together' : 'The habitat is ready');
  const prompt = state.phase === 'ready' ? 'The streamer will start the next field session.' : state.phase === 'complete' ? 'Three choices. One shared simulation. The story belongs to this community.' : round?.prompt ?? '';
  const status = state.phase === 'paused' ? 'PAUSED' : state.phase === 'review' ? 'STREAMER REVIEW' : state.phase === 'voting' ? 'CHAT VOTING' : state.phase === 'complete' ? 'FIELD NOTES' : 'READY';
  const deadline = state.phase === 'voting' || state.phase === 'paused' && state.pausedFrom === 'voting' ? fmtTime(currentRemainingMs()) : state.phase === 'review' ? 'Review' : state.phase === 'complete' ? 'Complete' : 'Ready';
  const totalVotes = state.voteTotal ?? 0;
  const cards = complete
    ? (content?.rounds ?? []).map((item,index) => {
      const entry = state.history.find((choice) => choice.roundId === item.id);
      const skipped = state.skippedRounds?.find((choice) => choice.roundId === item.id);
      return `<div class="overlay-option ${skipped ? 'overlay-skipped' : ''}"><b>0${index+1}</b><span>${esc(entry?.choiceLabel ?? (skipped ? 'Round discarded' : 'Not reached'))}</span><span class="overlay-votes">${entry ? `${Object.values(entry.votes).reduce((a,b)=>a+b,0)} votes` : skipped ? 'No effect applied' : ''}</span></div>`;
    }).join('')
    : (round?.options ?? []).map((option,index) => {
      const votes = state.votes[option.id] ?? 0;
      const percent = totalVotes ? Math.round(votes / totalVotes * 100) : 0;
      return `<div class="overlay-option"><b>${index+1}</b><span>${esc(option.shortLabel)} <small class="overlay-cost">· ${option.cost} game token${option.cost === 1 ? '' : 's'}</small></span><span class="overlay-votes">${votes} · ${percent}%</span><span class="overlay-vote-track" aria-hidden="true"><span style="width:${percent}%"></span></span></div>`;
    }).join('');
  const sourceLink = source ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.publisher)} · ${esc(source.title)} ↗</a>` : '<span>Source card appears when the session begins.</span>';
  const action = complete ? content?.actions?.find((item) => item.optional) : null;
  const metricLabels = content?.metrics ?? {};
  root.innerHTML = `<div class="overlay-card ${complete ? 'overlay-complete' : ''}"><div class="overlay-top"><span class="overlay-brand">✳ Habitat Relay · Pollinator corridor · SIMULATION</span><div class="overlay-state"><span class="overlay-demo">${state.mode === 'demo' ? 'DEMO DATA' : 'LIVE'} · ${esc(status)}</span><span class="overlay-deadline" id="overlay-deadline" aria-label="Round time remaining">${esc(deadline)}</span></div></div><div class="overlay-content"><div class="overlay-art">${sceneSvg(state.metrics,true)}</div><div class="overlay-copy"><div class="eyebrow">${esc(complete ? 'THE COMMUNITY’S FIELD NOTES' : round?.eyebrow ?? 'A SHARED LANDSCAPE')}</div><h1>${esc(title)}</h1><p>${esc(prompt)}</p><div class="overlay-choice" aria-label="${complete ? 'Session outcome' : 'Vote tally'}">${cards}</div>${state.phase === 'voting' ? '<p class="overlay-disclaimer">Vote in chat: <strong>!habitat 1</strong> or <strong>!habitat 2</strong> · no speed bonus</p>' : ''}${state.phase === 'review' ? '<p class="overlay-review">The round is closed. The streamer is reviewing the community’s choice.</p>' : ''}${state.phase === 'paused' ? '<p class="overlay-paused">The field is at rest. The round timer is paused.</p>' : ''}</div></div><div class="overlay-metrics">${Object.entries(metricLabels).map(([key,label])=>`<span class="overlay-metric">${esc(label)} <strong>${Math.round(state.metrics[key] ?? 0)}</strong></span>`).join('')}<span class="overlay-metric">Fictional field tokens <strong>${state.resourceBudget}/${state.resourceBudgetMax}</strong></span></div><div class="overlay-source"><span aria-hidden="true">✳</span><span><strong>Background source:</strong> ${sourceLink}</span></div>${action ? `<div class="overlay-action"><span><strong>Optional, outside the game:</strong> ${esc(action.description)}</span><a href="/action/${encodeURIComponent(action.id)}" target="_blank" rel="noopener noreferrer">${esc(action.label)} ↗</a></div>` : ''}<div class="overlay-footer">Simulation indicators · not ecological measurements or a real-world impact claim</div></div>`;
}

function render() { overlayMode ? renderOverlay() : renderStudio(); }

async function refreshEvents() {
  if (overlayMode) return;
  try { eventLog = await request('/api/events'); } catch { /* session view remains usable if the log refresh is temporarily unavailable */ }
}
function scheduleEventRefresh() {
  clearTimeout(eventRefreshTimer);
  eventRefreshTimer = setTimeout(async () => { await refreshEvents(); render(); }, 250);
}
async function refreshOperatorStatus() {
  if (overlayMode) return;
  try { operatorStatus = await request('/api/operator/status'); } catch { operatorStatus = { canUndoLastChoice: false }; }
}
async function command(name, payload = {}) {
  try {
    const result = await request('/api/command', { method: 'POST', body: JSON.stringify({ command: name, payload }) });
    state = result.state;
    syncClock(state);
    await Promise.all([refreshOperatorStatus(), refreshEvents(), refreshOverlayUrl()]);
    render();
    if (name === 'start') notify(payload.mode === 'live' ? 'Live session started. Chat can vote with !habitat 1 or !habitat 2.' : 'Demo started. Add sample votes to see the habitat change.');
    else if (name === 'close-round') notify(state.voteOutcome === 'tie' ? 'The vote is tied. Choose the path you want to commit.' : state.voteOutcome === 'no-votes' ? 'No votes arrived. Choose a path or reset.' : 'Round closed. Review the audience choice before committing.');
    else if (name === 'approve-choice') notify(state.phase === 'complete' ? 'The field notes are ready.' : 'Choice committed. The next round is open.');
    else if (name === 'sample-votes') notify(`Added ${result.result.accepted} sample audience votes.`);
    else if (name === 'reset') notify('Session reset. The habitat is back at its starting state.');
    else if (name === 'pause') notify('Session paused. Timer and voting are held.');
    else if (name === 'resume') notify('Session resumed.');
    else if (name === 'discard-round') notify(state.phase === 'complete' ? 'Final round discarded. The session is complete.' : 'Round discarded. No habitat effects were applied.');
    else if (name === 'undo-last-choice') notify('Last committed choice undone. It is back in streamer review.');
  } catch (error) { notify(error.message); }
}

root.addEventListener('change', (event) => {
  if (event.target.matches('#confirm-live-channel')) {
    liveConfirmed = event.target.checked;
    lastConfirmedChannelId = liveConfirmed ? twitch.profile?.id ?? null : null;
    const liveButton = root.querySelector('[data-command="start"][data-mode="live"]');
    if (liveButton) liveButton.disabled = !liveConfirmed || !twitch.ready || lastConfirmedChannelId !== twitch.profile?.id;
  }
});

root.addEventListener('click', async (event) => {
  const copyOverlayButton = event.target.closest('[data-copy-overlay]');
  if (copyOverlayButton) {
    if (!overlayUrl) { notify('The OBS link is not ready yet.'); return; }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(overlayUrl);
      else window.prompt('Copy this session-only OBS Browser Source URL:', overlayUrl);
      notify('Session-only OBS URL copied. Resetting the session revokes this link.');
    } catch { window.prompt('Copy this session-only OBS Browser Source URL:', overlayUrl); }
    return;
  }
  const disconnectButton = event.target.closest('[data-twitch-action="disconnect"]');
  if (disconnectButton) {
    try {
      const response = await request('/api/twitch/disconnect', { method: 'POST', body: JSON.stringify({}) });
      twitch = response.status;
      liveConfirmed = false;
      lastConfirmedChannelId = null;
      render();
      notify('Twitch account disconnected and saved credentials removed.');
    } catch (error) { notify(error.message); }
    return;
  }
  const commandButton = event.target.closest('[data-command]');
  if (commandButton) {
    const name = commandButton.dataset.command;
    if (name === 'reset' && !window.confirm(`Reset session ${state.id.slice(0, 8)}? This clears the current game state and starts a fresh session.`)) return;
    if (name === 'discard-round' && !window.confirm('Discard this round? Its ballots will not change habitat metrics, and the scenario will move to the next stop.')) return;
    if (name === 'undo-last-choice' && !window.confirm('Undo the last committed choice? This is only available before the next round receives votes; the round will return to streamer review.')) return;
    const sampleCounts = commandButton.dataset.sampleCounts;
    const payload = name === 'sample-votes'
      ? { counts: (sampleCounts ?? '4,3').split(',').map(Number) }
      : { mode: commandButton.dataset.mode };
    if (name === 'start' && payload.mode === 'live') payload.confirmChannelId = liveConfirmed ? twitch.profile?.id : null;
    await command(name, payload);
    return;
  }
  const voteButton = event.target.closest('[data-vote-option]');
  if (voteButton) {
    try {
      const body = await request('/api/vote', { method: 'POST', body: JSON.stringify({ optionId: voteButton.dataset.voteOption, actor: 'studio-preview' }) });
      state = body.state; render(); notify('Test vote recorded in demo mode.');
    } catch (error) { notify(error.message); }
    return;
  }
  const selectButton = event.target.closest('[data-select-choice]');
  if (selectButton) {
    await command('select-choice', { choiceId: selectButton.dataset.selectChoice });
  }
});

async function load() {
  try {
    const overlayKey = query.get('key');
    const overlayQuery = overlayMode ? `?overlayKey=${encodeURIComponent(overlayKey ?? '')}` : '';
    const stateRequest = request(`/api/state${overlayQuery}`);
    const contentRequest = request(`/api/content${overlayQuery}`);
    const operatorRequests = overlayMode
      ? [Promise.resolve({ configured: false, connected: false, ready: false, profile: null }), Promise.resolve({ canUndoLastChoice: false }), Promise.resolve([]), Promise.resolve(null)]
      : [request('/api/twitch/status'), request('/api/operator/status'), request('/api/events'), request('/api/operator/overlay-link')];
    const [nextState, nextContent, nextTwitch, nextOperator, nextEvents, nextOverlay] = await Promise.all([stateRequest, contentRequest, ...operatorRequests]);
    state = nextState;
    syncClock(state);
    content = nextContent;
    twitch = nextTwitch;
    operatorStatus = nextOperator;
    eventLog = nextEvents;
    if (nextOverlay) { overlayUrl = nextOverlay.url; lastSessionId = nextOverlay.sessionId; }
    lastConfirmedChannelId = twitch.profile?.id ?? null;
    lastRevision = state.revision;
    render();
    const streamUrl = new URL('/api/stream', location.origin);
    if (overlayMode) streamUrl.searchParams.set('overlayKey', overlayKey ?? '');
    eventSource = new EventSource(streamUrl);
    eventSource.addEventListener('state', async (event) => {
      const next = JSON.parse(event.data);
      if (next.revision !== lastRevision) {
        const phaseChanged = state?.phase !== next.phase;
        const oldHistory = state?.history?.length ?? 0;
        const sessionChanged = state?.id !== next.id;
        state = next;
        syncClock(state);
        lastRevision = next.revision;
        if (sessionChanged) {
          liveConfirmed = false;
          await refreshOverlayUrl();
        }
        await refreshOperatorStatus();
        render();
        scheduleEventRefresh();
        if (!overlayMode && phaseChanged && next.phase === 'review') notify('Round closed. Review the audience choice.');
        if (!overlayMode && next.history?.length > oldHistory && next.phase !== 'complete') notify('Choice approved. The next round has begun.');
      }
    });
    eventSource.addEventListener('twitch', (event) => {
      const next = JSON.parse(event.data);
      if (twitch.profile?.id !== next.profile?.id) { liveConfirmed = false; lastConfirmedChannelId = null; }
      twitch = next;
      if (!next.connected) { liveConfirmed = false; lastConfirmedChannelId = null; }
      render();
    });
    eventSource.addEventListener('activity', scheduleEventRefresh);
    eventSource.addEventListener('clock', (event) => {
      const clock = JSON.parse(event.data);
      displayRemainingMs = clock.remainingMs;
      sessionElapsedMs = clock.sessionElapsedMs ?? sessionElapsedMs;
      clockReceivedAt = elapsedReceivedAt = performance.now();
    });
    eventSource.addEventListener('overlay-revoked', () => {
      overlayRevoked = true;
      eventSource.close();
      root.innerHTML = '<div class="overlay-card overlay-revoked"><h1>OBS link revoked</h1><p>This session ended or was reset. Update the Browser Source using the current link from the Habitat Relay studio.</p></div>';
    });
    eventSource.onerror = () => {
      if (!overlayMode) notify('Live updates interrupted. Reconnecting to the field station…');
    };
    if (query.has('connected')) notify('Twitch account authorized. Verify the selected channel and wait for chat to be ready before starting live.');
    else if (oauthMessage) notify(oauthMessage);
  } catch (error) {
    root.innerHTML = `<div class="shell"><section class="panel round-panel"><div class="eyebrow">FIELD STATION OFFLINE</div><h2>${overlayMode ? 'OBS link unavailable.' : 'Could not load Habitat Relay.'}</h2><p class="round-prompt">${esc(error.message)} ${overlayMode ? 'The link may have expired after a reset; copy the current URL from the studio.' : 'Start the Node server and refresh this page.'}</p>${overlayMode ? '' : '<a class="button button-primary" href="/">Try again</a>'}</section></div>`;
  }
}

setInterval(() => {
  if (state?.phase === 'voting') {
    const timerNode = document.querySelector('#timer');
    if (timerNode) timerNode.textContent = fmtTime(currentRemainingMs());
  }
  if (state?.phase === 'voting' || state?.phase === 'paused' && state.pausedFrom === 'voting') {
    const overlayTimer = document.querySelector('#overlay-deadline');
    if (overlayTimer) overlayTimer.textContent = fmtTime(currentRemainingMs());
  }
  const elapsed = document.querySelector('#session-elapsed');
  if (elapsed && state?.createdAt) elapsed.textContent = fmtElapsed(currentSessionElapsedMs());
}, 250);

load();
