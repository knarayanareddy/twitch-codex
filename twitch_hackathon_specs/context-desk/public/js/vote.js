const fieldset = document.querySelector('#choices');
const feedback = document.querySelector('#vote-feedback');
const submit = document.querySelector('#submit-vote');
const form = document.querySelector('#vote-form');
let pollKey = null; let currentPoll = null;
function node(tag, cls, text) { const item = document.createElement(tag); if (cls) item.className = cls; if (text != null) item.textContent = text; return item; }
async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'The poll could not be loaded.');
  return data;
}
function render(poll) {
  currentPoll = poll; fieldset.replaceChildren();
  const legend = node('legend', 'visually-hidden', poll.question); fieldset.append(legend);
  const max = Math.max(1, ...poll.choices.map((choice) => choice.votes));
  for (const choice of poll.choices) {
    const id = `choice-${choice.id}`; const label = node('label', 'choice');
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'choice'; radio.id = id; radio.value = choice.id; radio.disabled = poll.alreadyVoted;
    const title = node('span', 'choice-text', choice.question); title.id = `${id}-label`;
    const count = node('span', 'choice-tally', `${choice.votes} vote${choice.votes === 1 ? '' : 's'}`);
    const track = document.createElement('progress'); track.className = 'choice-track'; track.max = max; track.value = choice.votes; track.setAttribute('aria-hidden', 'true');
    label.htmlFor = id; label.append(radio, title, count, track); fieldset.append(label);
    radio.addEventListener('change', () => { document.querySelectorAll('.choice').forEach((row) => row.classList.remove('selected')); label.classList.add('selected'); submit.disabled = false; });
  }
  if (poll.alreadyVoted) { feedback.textContent = `Your vote is counted. ${poll.totalVotes} anonymous vote${poll.totalVotes === 1 ? '' : 's'} in the last 24 hours.`; submit.disabled = true; submit.textContent = 'Vote already counted'; }
  else { feedback.textContent = `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'} so far. One vote per browser token.`; submit.disabled = true; submit.innerHTML = 'Cast my vote <span aria-hidden="true">→</span>'; }
}
async function loadPoll() {
  pollKey = new URL(location.href).searchParams.get('session');
  if (!pollKey || !/^[a-f0-9]{24,64}$/i.test(pollKey)) { feedback.textContent = 'This viewer poll link is incomplete. Ask the broadcaster for the current link.'; feedback.classList.add('vote-error'); submit.disabled = true; return; }
  try { render(await request(`/api/vote/${encodeURIComponent(pollKey)}`)); }
  catch (error) { feedback.textContent = error.message; feedback.classList.add('vote-error'); submit.disabled = true; }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const choiceId = new FormData(form).get('choice');
  if (!choiceId || !pollKey || currentPoll?.alreadyVoted) return;
  submit.disabled = true; feedback.textContent = 'Recording your topic vote…';
  try {
    const result = await request(`/api/vote/${encodeURIComponent(pollKey)}`, { method: 'POST', body: JSON.stringify({ choiceId }) });
    render(result);
    if (result.accepted) feedback.textContent = `Thank you. Your vote is counted; ${result.totalVotes} anonymous vote${result.totalVotes === 1 ? '' : 's'} total.`;
    else if (result.reason === 'already-voted') feedback.textContent = 'A vote from this browser token is already counted. Here are the current tallies.';
  } catch (error) { feedback.textContent = error.message; feedback.classList.add('vote-error'); submit.disabled = false; }
});
loadPoll();
