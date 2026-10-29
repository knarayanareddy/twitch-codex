const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { auth: null, config: null, questions: [], selectedId: null, view: 'review', dialogAction: null, eventSource: null, poll: null, queueFilter: 'all' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}
function toast(message, kind = '') {
  const node = el('div', `toast ${kind}`, message);
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 4100);
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = data?.error || {};
    const issue = new Error(error.message || `Request failed (${response.status}).`);
    issue.status = response.status; issue.code = error.code;
    throw issue;
  }
  return data;
}
function showLogin(message = '') {
  $('#app').hidden = true; $('#login-gate').hidden = false;
  const error = $('#login-error');
  error.hidden = !message; error.textContent = message;
  if (state.eventSource) state.eventSource.close();
}
function showApp() { $('#login-gate').hidden = true; $('#app').hidden = false; }
function getStatusLabel(status) {
  return ({ 'review-required': ['Needs review', 'status-review'], 'queued': ['Queued', 'status-review'], 'insufficient-evidence': ['Not enough evidence', 'status-insufficient'], 'out-of-scope': ['Out of scope', 'status-insufficient'], 'rejected': ['Not published', 'status-rejected'], 'published': ['Published', 'status-published'], 'failed': ['Not available', 'status-insufficient'], 'cancelled': ['Cancelled', 'status-insufficient'] })[status] || ['Needs review', 'status-review'];
}
function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
function formatAuditTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function formatAge(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return 'time unknown';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function sourceHost(link) {
  try { const parsed = new URL(link); return parsed.protocol === 'https:' ? parsed.hostname : 'Source link'; } catch { return 'Source link'; }
}
function safeSourceAnchor(source, text = 'Open source ↗') {
  const anchor = el('a', 'evidence-link', text);
  try { const url = new URL(source.url); if (url.protocol !== 'https:' || !['science.nasa.gov', 'ssd.jpl.nasa.gov'].includes(url.hostname)) throw new Error(); anchor.href = url.href; }
  catch { anchor.removeAttribute('href'); anchor.setAttribute('aria-disabled', 'true'); }
  anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.setAttribute('aria-label', `${text}: ${source.sourceTitle} (${source.publisher}), opens in a new tab`);
  return anchor;
}
function selectedQuestion() { return state.questions.find((question) => question.id === state.selectedId) || null; }
function setView(view) {
  state.view = view;
  $$('.view').forEach((section) => { section.hidden = section.id !== `view-${view}`; });
  $$('.nav-link').forEach((button) => { const active = button.dataset.view === view; button.classList.toggle('active', active); active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current'); });
  if (view === 'recap') loadRecap();
  if (view === 'settings') loadVoteResults();
  if (view === 'review') renderReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderQueue() {
  const list = $('#queue-list'); list.replaceChildren();
  const activeStates = ['queued', 'retrieving', 'review-required'];
  const active = state.questions.filter((q) => activeStates.includes(q.state));
  const visible = state.questions.filter((q) => state.queueFilter === 'all' || (state.queueFilter === 'active' ? activeStates.includes(q.state) : !activeStates.includes(q.state)));
  if (state.selectedId && !visible.some((q) => q.id === state.selectedId)) state.selectedId = null;
  $('#queue-count').textContent = String(active.length);
  $('#queue-count-heading').textContent = String(active.length);
  $$('.queue-filter button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.queueFilter === state.queueFilter)));
  $('#queue-empty').hidden = visible.length > 0;
  if (state.questions.length && !visible.length) {
    $('#queue-empty').querySelector('p').textContent = state.queueFilter === 'active' ? 'Nothing awaiting review.' : 'No closed items yet.';
    $('#queue-empty').querySelector('span:last-child').textContent = state.queueFilter === 'active' ? 'New questions will appear here. Closed decisions stay in History.' : 'Closed, failed, and completed questions will appear here with their audit trail.';
  } else if (!state.questions.length) {
    $('#queue-empty').querySelector('p').textContent = 'Room to think.';
    $('#queue-empty').querySelector('span:last-child').textContent = 'New questions will appear here. Start with a sample or write one above.';
  }
  for (const question of visible) {
    const listItem = el('div', 'queue-list-item'); listItem.setAttribute('role', 'listitem');
    const item = document.createElement('button'); item.type = 'button'; item.className = `queue-item${question.id === state.selectedId ? ' selected' : ''}`;
    item.setAttribute('aria-pressed', question.id === state.selectedId ? 'true' : 'false');
    const title = el('span', 'queue-question', question.text); const meta = el('span', 'queue-meta');
    const [status, statusClass] = getStatusLabel(question.state); meta.append(el('span', `status-label ${statusClass}`, status));
    const sourceLabel = question.source === 'demo-fixture' ? 'DEMO FIXTURE' : question.source === 'twitch-eventsub' ? 'TWITCH EVENTSUB' : question.source === 'viewer-poll' ? 'VIEWER POLL' : 'STUDIO';
    const right = el('span', 'source-tag', `${sourceLabel} · ${formatAge(question.createdAt)}`);
    meta.append(right); item.append(title, meta);
    item.addEventListener('click', () => { state.selectedId = question.id; renderQueue(); renderReview(); });
    listItem.append(item); list.append(listItem);
  }
}
function evidenceCard(item, forReview = false) {
  const card = el('article', 'evidence-card');
  const head = el('div', 'evidence-card-head'); const titleWrap = document.createElement('div');
  titleWrap.append(el('h3', '', item.sourceTitle), el('p', 'evidence-publisher', item.publisher)); head.append(titleWrap);
  if (forReview) { const check = el('label', 'evidence-check'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'evidence-id'; input.value = item.id; input.checked = false; input.setAttribute('aria-label', `Cite ${item.sourceTitle} from ${item.publisher}`); check.append(input, document.createTextNode('Include citation')); head.append(check); }
  card.append(head);
  const excerpt = document.createElement('blockquote'); excerpt.textContent = item.excerpt; card.append(excerpt);
  const foot = el('div', 'evidence-foot'); foot.append(el('span', 'evidence-date', `Checked ${item.checkedAt || 'date not recorded'}`), safeSourceAnchor(item)); card.append(foot);
  if (item.licenseUsageNote) card.append(el('p', 'evidence-usage', item.licenseUsageNote));
  return card;
}
function buildPreview(publicQuestion, title, bullets, summary, uncertainty, evidence) {
  const frame = el('div', 'broadcast-frame'); frame.setAttribute('aria-label', 'Overlay preview at 16 by 9');
  const card = el('article', 'overlay-card');
  const eyebrow = el('div', 'overlay-eyebrow'); eyebrow.append(el('span', 'overlay-dot'), document.createTextNode('BROADCASTER REVIEWED · CONTEXT DESK'));
  card.append(eyebrow, el('p', 'overlay-question', publicQuestion || 'Your approved public question'), el('h3', 'overlay-title', title || 'Your approved card title'));
  const list = el('ul', 'overlay-bullets'); for (const bullet of bullets.slice(0, 3)) if (bullet) list.append(el('li', '', bullet)); if (list.childElementCount) card.append(list);
  card.append(el('p', 'overlay-summary', summary || 'The context summary will appear here after review.'));
  const caveat = el('p', 'overlay-uncertainty', uncertainty || 'What we cannot conclude will appear here.'); card.append(caveat);
  const links = el('div', 'overlay-sources');
  for (const source of evidence.slice(0, 2)) { const a = safeSourceAnchor(source, `${source.sourceTitle} · ${sourceHost(source.url)} ↗`); links.append(a); }
  if (evidence.length) card.append(links);
  const foot = el('div', 'overlay-foot'); foot.append(el('span', '', 'Human-approved · Context Desk'), el('span', '', 'Source pack v1.0.0')); card.append(foot);
  frame.append(card); return frame;
}
function messageForReason(code) {
  return ({ 'volatile-current-count': 'The curated source page contains changing discovery counts, so the pack deliberately keeps no live total. No number was drafted.', 'outside-topic-pack': 'Not enough evidence in the Solar System Basics source pack. No public card can be drafted.', 'medical-advice': 'This is outside the educational topic scope. No draft was created or published.', 'legal-advice': 'This is outside the educational topic scope. No draft was created or published.', 'financial-advice': 'This is outside the educational topic scope. No draft was created or published.', 'emergency-advice': 'This is outside the educational topic scope. No draft was created or published.', 'political-persuasion': 'This is outside the educational topic scope. No draft was created or published.', 'personal-accusation': 'Questions about identifiable people are outside scope. No draft was created or published.', 'private-information': 'Personal or private information is not accepted. No draft was created or published.', 'speculation': 'Predictions and speculative claims are outside this source pack. No draft was created or published.', 'no-matching-evidence': 'Not enough evidence in the Solar System Basics source pack. No public card can be drafted.', 'no-safe-template': 'Evidence was found, but the local retrieval cannot form a safe, supported context card for this wording.' })[code] || 'Not enough evidence in this source pack. No public card can be drafted.';
}
function renderAudit(question, root) {
  const events = question.events || [];
  if (!events.length) return;
  const section = el('div', 'audit-trail');
  section.append(el('p', 'section-title', 'Review history'));
  const list = el('ul', 'audit-list');
  for (const event of events) { const item = document.createElement('li'); item.append(el('span', '', `${event.action.replaceAll('-', ' ')} · ${event.actorRole.replaceAll('-', ' ')}`), el('time', '', formatAuditTime(event.createdAt))); list.append(item); }
  section.append(list); root.append(section);
}
function renderReview() {
  renderQueue();
  const root = $('#review-content'); root.replaceChildren(); const question = selectedQuestion();
  $('#no-selection').hidden = Boolean(question); root.hidden = !question;
  if (!question) return;
  const reviewable = question.state === 'review-required';
  const evidenceSection = el('section', 'evidence-section'); evidenceSection.append(el('h3', 'section-title', `Evidence found · ${question.evidence.length}`));
  if (question.evidence.length) {
    const grid = el('div', 'evidence-grid'); question.evidence.forEach((source) => grid.append(evidenceCard(source, reviewable))); evidenceSection.append(grid);
    evidenceSection.append(el('p', 'retrieval-note', 'Local lexical match · no external fetch · no model used. Evidence is shown before the draft.'));
  } else evidenceSection.append(el('div', 'no-evidence', 'No relevant source excerpt was retrieved from the active pack. The question cannot be published from this evidence set.'));

  if (!reviewable) {
    const wrap = el('div', question.state === 'insufficient-evidence' || question.state === 'out-of-scope' ? 'insufficient-view' : 'review-content');
    const [label, statusClass] = getStatusLabel(question.state);
    wrap.append(el('p', `status-label ${statusClass}`, label));
    if (question.state === 'insufficient-evidence' || question.state === 'out-of-scope') {
      const box = el('div', 'insufficient-banner'); box.append(el('h3', '', question.state === 'out-of-scope' ? 'Outside this source pack.' : 'No safe draft this time.'), el('p', '', messageForReason(question.reasonCode))); wrap.append(box);
    } else if (question.state === 'published') wrap.append(el('p', 'review-closed', 'This card is published. It appears in the approved read-only overlay and recap.'));
    else wrap.append(el('p', 'review-closed', `This question is ${question.state}. No public card is available.`));
    if (question.evidence.length) wrap.append(evidenceSection);
    renderAudit(question, wrap); root.append(wrap); return;
  }

  const top = el('div', 'review-top');
  const sourceEyebrow = question.source === 'demo-fixture' ? 'DEMO FIXTURE · QUESTION' : question.source === 'viewer-poll' ? 'VIEWER POLL · FIXED PROMPT' : question.source === 'twitch-eventsub' ? 'TWITCH EVENTSUB · QUESTION' : 'QUESTION FOR REVIEW';
  const head = document.createElement('div'); head.append(el('p', 'eyebrow', sourceEyebrow), el('h2', '', question.text));
  const meta = el('div', 'review-meta'); meta.append(el('span', 'status-pill', 'Needs human review'), el('span', '', `Added ${formatTime(question.createdAt)}`), el('span', '', `· pack ${question.packVersion}`)); head.append(meta); top.append(head); root.append(top, evidenceSection);
  const gap = el('section', 'gap-section'); gap.append(el('h3', 'section-title', 'Evidence that disagrees / gaps'), el('div', 'gap-note', question.draft?.uncertainty || 'The selected source set does not resolve every detail. Do not go beyond what these excerpts support.')); root.append(gap);

  const draft = question.draft;
  const section = el('section', 'draft-section'); section.append(el('h3', 'section-title', 'Draft context · deterministic template · edit before approving'));
  const fields = el('div', 'draft-fields');
  const promptField = document.createElement('textarea'); promptField.className = 'draft-field title-field'; promptField.rows = 1; promptField.maxLength = 160; promptField.value = draft?.publicQuestion || ''; promptField.setAttribute('aria-label', 'Approved public question');
  const promptLabel = el('label', 'field-label', 'Approved question · public on card'); promptLabel.append(promptField);
  const titleField = document.createElement('textarea'); titleField.className = 'draft-field title-field'; titleField.rows = 1; titleField.maxLength = 90; titleField.value = draft?.title || ''; titleField.setAttribute('aria-label', 'Public context card title'); titleField.dataset.field = 'title';
  const titleLabel = el('label', 'field-label', 'Card title · public'); titleLabel.append(titleField);
  const bulletFields = [];
  for (let index = 0; index < 3; index++) {
    const bulletField = document.createElement('textarea'); bulletField.className = 'draft-field bullet-field'; bulletField.rows = 1; bulletField.maxLength = 140; bulletField.value = draft?.bullets?.[index] || ''; bulletField.setAttribute('aria-label', `Context bullet ${index + 1} · public`); bulletFields.push(bulletField);
    const bulletLabel = el('label', 'field-label', `Context bullet ${index + 1} · public`); bulletLabel.append(bulletField); fields.append(bulletLabel);
  }
  const summaryField = document.createElement('textarea'); summaryField.className = 'draft-field'; summaryField.rows = 4; summaryField.maxLength = 420; summaryField.value = draft?.summary || ''; summaryField.setAttribute('aria-label', 'Public context summary'); summaryField.dataset.field = 'summary';
  const summaryLabel = el('label', 'field-label', 'Context summary · public'); summaryLabel.append(summaryField);
  const caveatField = document.createElement('textarea'); caveatField.className = 'draft-field caveat-field'; caveatField.rows = 2; caveatField.maxLength = 240; caveatField.value = draft?.uncertainty || ''; caveatField.setAttribute('aria-label', 'Public uncertainty note'); caveatField.dataset.field = 'uncertainty';
  const caveatLabel = el('label', 'field-label', 'What we cannot conclude · public'); caveatLabel.append(caveatField);
  fields.prepend(promptLabel, titleLabel); fields.append(summaryLabel, caveatLabel); section.append(fields);
  const previewLabel = el('h3', 'section-title', 'Exact broadcast preview · 16:9'); section.append(previewLabel);
  const previewHolder = el('div', 'preview-holder');
  const updatePreview = () => {
    const chosen = $$('input[name="evidence-id"]:checked', root).map((input) => question.evidence.find((item) => item.id === input.value)).filter(Boolean);
    previewHolder.replaceChildren(buildPreview(promptField.value, titleField.value, bulletFields.map((field) => field.value.trim()).filter(Boolean), summaryField.value, caveatField.value, chosen));
  };
  for (const field of [promptField, titleField, ...bulletFields, summaryField, caveatField]) field.addEventListener('input', updatePreview);
  root.onchange = (event) => { if (event.target.matches('input[name="evidence-id"]')) updatePreview(); };
  section.append(previewHolder);
  const confirm = el('label', 'approve-confirm'); const check = document.createElement('input'); check.type = 'checkbox'; check.setAttribute('aria-label', 'I reviewed the sources and exact preview'); confirm.append(check, document.createTextNode(' I reviewed the sources and exact preview; publish this card to the read-only overlay.'));
  section.append(confirm); root.append(section);
  updatePreview();

  const bar = el('div', 'decision-bar'); bar.append(el('span', 'decision-hint', 'Only the authenticated broadcaster can publish. Citations must come from evidence above.'));
  const actions = el('div', 'decision-actions');
  const approve = el('button', 'button primary small', 'Approve for overlay →'); approve.type = 'button'; approve.disabled = false;
  approve.addEventListener('click', async () => {
    if (!check.checked) { toast('Review the preview and check the confirmation box first.', 'warning'); check.focus(); return; }
    const evidenceIds = $$('input[name="evidence-id"]:checked', root).map((input) => input.value);
    try { await api(`/api/questions/${question.id}/approve`, { method: 'POST', body: JSON.stringify({ publicQuestion: promptField.value, title: titleField.value, summary: summaryField.value, uncertainty: caveatField.value, bullets: bulletFields.map((field) => field.value.trim()).filter(Boolean), evidenceIds, confirmed: true }) }); state.selectedId = null; await refreshQueue(); toast('Published. The approved card is now on the read-only overlay.'); }
    catch (error) { toast(error.message, 'error'); }
  });
  const reject = el('button', 'button danger-outline small', 'Reject'); reject.type = 'button'; reject.addEventListener('click', () => openDecision(question.id, 'reject'));
  const insufficient = el('button', 'button quiet small', 'Insufficient evidence'); insufficient.type = 'button'; insufficient.addEventListener('click', () => openDecision(question.id, 'insufficient-evidence'));
  const cancel = el('button', 'button quiet small', 'Cancel item'); cancel.type = 'button'; cancel.addEventListener('click', () => openDecision(question.id, 'cancel'));
  actions.append(insufficient, reject, cancel, approve); bar.append(actions); root.append(bar);
  renderAudit(question, root);
}
function openDecision(questionId, action) {
  state.dialogAction = { questionId, action };
  $('#dialog-title').textContent = action === 'reject' ? 'Reject this question' : action === 'cancel' ? 'Cancel this review item' : 'Mark insufficient evidence';
  $('#dialog-description').textContent = action === 'reject' ? 'This question will be closed without a public card. Choose a reason for the private review history.' : action === 'cancel' ? 'This item will be removed from the active review queue without a public card. Choose a reason.' : 'This question will be closed without a public card. Choose why the evidence is insufficient.';
  $('#reason-select').value = ''; $('#decision-dialog').showModal();
}
$('#decision-dialog').addEventListener('close', async () => {
  if ($('#decision-dialog').returnValue !== 'confirm' || !state.dialogAction) { state.dialogAction = null; return; }
  const { questionId, action } = state.dialogAction; const reasonCode = $('#reason-select').value; state.dialogAction = null;
  if (!reasonCode) { toast('Choose a reason to save this review decision.', 'warning'); return; }
  try { await api(`/api/questions/${questionId}/${action}`, { method: 'POST', body: JSON.stringify({ reasonCode }) }); state.selectedId = null; await refreshQueue(); toast(action === 'reject' ? 'Question rejected. Nothing was published.' : action === 'cancel' ? 'Review item cancelled. Nothing was published.' : 'Marked insufficient evidence. Nothing was published.'); }
  catch (error) { toast(error.message, 'error'); }
});
async function refreshQueue() {
  const data = await api('/api/review-queue'); state.questions = data.questions;
  if (state.selectedId && !state.questions.some((q) => q.id === state.selectedId)) state.selectedId = null;
  renderQueue(); renderReview();
}
async function loadRecap() {
  try { const { cards } = await api('/api/recap'); const root = $('#recap-list'); root.replaceChildren(); $('#recap-empty').hidden = cards.length > 0;
    for (const card of cards) {
      const article = el('article', 'recap-card'); const top = el('div', 'recap-top'); top.append(el('h2', '', card.publicQuestion || card.title), el('span', 'reviewed-tag', `${card.state === 'archived' ? 'Archived · ' : ''}${card.reviewLabel}`)); article.append(top, el('h3', 'recap-card-title', card.title));
      const bullets = el('ul', 'recap-bullets'); for (const bullet of (card.bullets || []).slice(0, 3)) bullets.append(el('li', '', bullet)); if (bullets.childElementCount) article.append(bullets);
      article.append(el('p', '', card.summary), el('p', 'recap-provenance', card.provenanceLabel || 'Approved by broadcaster'));
      const caveat = el('p', 'recap-caveat', `What we cannot conclude: ${card.uncertainty}`); article.append(caveat);
      const sources = el('div', 'recap-sources'); sources.append(el('p', '', `Sources · published ${formatTime(card.publishedAt)}`));
      for (const source of card.evidence) sources.append(safeSourceAnchor(source, `${source.sourceTitle} — ${source.publisher} ↗`));
      article.append(sources, el('p', 'recap-date', `This card expires ${new Date(card.expiresAt).toLocaleString()}.`)); root.append(article);
    }
  } catch (error) { toast(error.message, 'error'); }
}
function renderVoteResults(data) {
  state.poll = data;
  const root = $('#vote-results'); root.replaceChildren();
  const max = Math.max(1, ...data.choices.map((choice) => choice.votes));
  const leader = data.choices.find((choice) => choice.votes === max && max > 0);
  for (const choice of data.choices) {
    const row = el('div', `vote-result-row${leader?.id === choice.id ? ' is-leading' : ''}`);
    row.append(el('span', '', choice.question));
    const track = document.createElement('progress'); track.className = 'vote-result-track'; track.max = max; track.value = choice.votes; track.setAttribute('aria-hidden', 'true'); row.append(track);
    row.append(el('span', 'vote-count', `${choice.votes} vote${choice.votes === 1 ? '' : 's'}`)); root.append(row);
  }
  $('#vote-admin-message').textContent = data.totalVotes ? `${data.totalVotes} anonymous vote${data.totalVotes === 1 ? '' : 's'} in the last 24 hours. Counts are for topic choice only.` : 'No votes yet. Share the viewer poll link to collect a topic preference.';
  $('#promote-vote').disabled = !data.totalVotes;
}
async function loadVoteResults() {
  try { renderVoteResults(await api('/api/vote-results')); }
  catch (error) { $('#vote-results').replaceChildren(); $('#vote-admin-message').textContent = error.message; $('#promote-vote').disabled = true; }
}
function renderSources() {
  $('#mode-badge').textContent = state.config.demoMode ? 'Local demo · broadcaster permission simulated' : 'Broadcaster session';
  const root = $('#source-list'); root.replaceChildren();
  $('#pack-title').textContent = state.config.pack.title; $('#pack-scope').textContent = state.config.pack.scope; $('#pack-version').textContent = `v${state.config.pack.version}`;
  $('#settings-pack-title').textContent = state.config.pack.title; $('#settings-pack-scope').textContent = state.config.pack.scope;
  $('#footer-version').textContent = `v${state.config.pack.version}`;
  for (const source of state.config.sources) {
    const article = el('article', 'source-item'); const head = el('div', 'source-item-head'); const name = document.createElement('div');
    name.append(el('h2', '', source.sourceTitle), el('p', 'publisher', source.publisher)); head.append(name, el('span', 'checked', `Checked ${source.checkedAt}`));
    article.append(head); article.append(el('blockquote', '', source.excerpt)); article.append(el('p', 'license', source.licenseUsageNote));
    const foot = el('div', 'source-item-foot'); foot.append(el('span', '', 'Team-authored paraphrase · local retrieval'), safeSourceAnchor(source)); article.append(foot); root.append(article);
  }
  const twitch = state.config.twitch;
  $('#twitch-state-title').textContent = twitch.connected ? `Connected · ${twitch.broadcasterLogin || 'broadcaster'}` : twitch.state === 'verification-pending' ? 'Authorization saved · webhook pending' : twitch.state === 'reauthorization-required' ? 'Reauthorization required' : twitch.state === 'revoked' ? 'EventSub revoked' : twitch.oauthReady ? 'Ready to connect' : 'Not connected';
  $('#twitch-state-note').textContent = twitch.note;
  $('#moderator-status').textContent = twitch.moderatorRoleVerification;
  const connect = $('#twitch-connect'); const disconnect = $('#twitch-disconnect');
  connect.hidden = state.config.demoMode || twitch.connected; connect.disabled = !twitch.oauthReady;
  connect.textContent = twitch.oauthReady ? 'Authorize Twitch chat access' : 'Twitch OAuth not configured';
  disconnect.hidden = state.config.demoMode || !twitch.connected;
  $('#twitch-oauth-copy').textContent = state.config.demoMode ? 'Local demo mode is intentionally unable to connect a real Twitch account. No chat authorization has been performed.' : 'Twitch authorization requests only user:read:chat and user:bot. Context Desk never sends chat or performs moderation actions.';
  $('#open-overlay').href = state.config.overlayPath;
  $('#open-viewer-poll').href = state.config.viewerVotePath;
}
async function startApp() {
  try { state.config = await api('/api/config'); showApp(); renderSources(); await refreshQueue(); }
  catch (error) { if (error.status === 401) showLogin(); else showLogin(error.message); }
}
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const passcode = $('#passcode').value;
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passcode }) }); $('#passcode').value = ''; await startApp(); }
  catch (error) { const message = error.code === 'AUTH_NOT_CONFIGURED' ? 'Local access is not set up. Copy .env.example to .env and set a passphrase of at least 12 characters for demo mode.' : error.message; showLogin(message); }
});
$$('.nav-link').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$$('.queue-filter button').forEach((button) => button.addEventListener('click', () => { state.queueFilter = button.dataset.queueFilter; renderQueue(); renderReview(); }));
$$('[data-view-link]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewLink)));
$('#question-input').addEventListener('input', (event) => { $('#char-count').textContent = `${[...event.target.value].length} / 280`; });
$('#question-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const input = $('#question-input');
  try { const result = await api('/api/questions', { method: 'POST', body: JSON.stringify({ question: input.value }) }); input.value = ''; $('#char-count').textContent = '0 / 280';
    if (result.duplicate) toast('That question is already in the queue; the duplicate was coalesced.'); else toast(result.message || 'Question added for review.');
    state.selectedId = result.question.id; await refreshQueue();
  } catch (error) { toast(error.message, 'error'); }
});
$('#load-samples').addEventListener('click', async () => {
  try { const { questions } = await api('/api/demo/samples', { method: 'POST', body: JSON.stringify({}) }); state.selectedId = questions.find((question) => question.state === 'review-required')?.id || questions[0]?.id || null; await refreshQueue(); toast('Three local demo fixtures loaded. They are labelled and are not Twitch messages.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {} showLogin(); });
$('#refresh-votes').addEventListener('click', loadVoteResults);
$('#promote-vote').addEventListener('click', async () => {
  try {
    const result = await api('/api/vote/promote', { method: 'POST', body: JSON.stringify({}) });
    await refreshQueue(); state.selectedId = result.question.id; setView('review');
    toast(result.duplicate ? 'That viewer-selected topic is already in the queue.' : 'The winning topic is queued for evidence review. It has not been approved or published.');
  } catch (error) { toast(error.message, 'error'); }
});
$('#twitch-connect').addEventListener('click', async () => {
  try { const { authorizeUrl } = await api('/api/twitch/connect/start', { method: 'POST', body: JSON.stringify({}) }); window.location.assign(authorizeUrl); }
  catch (error) { toast(error.message, 'error'); }
});
$('#twitch-disconnect').addEventListener('click', async () => {
  if (!window.confirm('Disconnect Twitch and stop accepting chat questions?')) return;
  try { await api('/api/twitch/disconnect', { method: 'POST', body: JSON.stringify({}) }); state.config = await api('/api/config'); renderSources(); toast('Twitch disconnected. Chat input is disabled.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#export-recap').addEventListener('click', async (event) => { event.preventDefault(); try { const response = await fetch('/api/recap/export', { credentials: 'same-origin' }); if (!response.ok) throw new Error('Could not export the recap.'); const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'context-desk-recap.md'; link.click(); URL.revokeObjectURL(link.href); } catch (error) { toast(error.message, 'error'); } });

async function boot() {
  try {
    const status = await api('/api/auth/status');
    if (status.authenticated) {
      await startApp();
      const outcome = new URL(location.href).searchParams.get('twitch');
      if (outcome) { toast(outcome === 'connected' ? 'Twitch authorization completed. The signed EventSub webhook must verify before chat is accepted.' : 'Twitch authorization did not complete. No chat input was enabled.', outcome === 'connected' ? '' : 'warning'); history.replaceState({}, '', location.pathname); }
      return;
    }
    if (status.setupRequired) showLogin('Set a local access passphrase in .env before using the review controls. No passphrase is shipped by default.');
    else showLogin();
  } catch (error) { showLogin(`The local desk could not connect: ${error.message}`); }
}
boot();
