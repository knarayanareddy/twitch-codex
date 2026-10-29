import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/adapters/store.js';
import { HabitatService } from '../src/application/habitat-service.js';

function fixture({ mode='demo', now=()=>1000, roundDurationMs=10_000 } = {}) {
  const store = new Store(':memory:');
  const service = new HabitatService({ store, now, voteSalt: 'stable-test-salt', roundDurationMs });
  if (mode !== 'demo') service.execute('reset', { mode });
  return { store, service };
}

test('service persists an initial state when database is empty', () => {
  const { store, service } = fixture();
  assert.equal(service.getState().phase, 'ready');
  assert.equal(store.loadState().id, service.getState().id);
  assert.equal(service.getEvents()[0].type, 'session-created');
  store.close();
});

test('service hydrates current state after restart', () => {
  const store = new Store(':memory:');
  let service = new HabitatService({ store, now: () => 1000, voteSalt: 'same' });
  service.execute('start', { mode: 'demo' });
  service.execute('sample-votes', { counts: [2,1] });
  const expected = service.getState();
  service = new HabitatService({ store, now: () => 2000, voteSalt: 'same' });
  const restored = service.getState();
  assert.equal(restored.id, expected.id);
  assert.equal(restored.phase, expected.phase);
  assert.equal(restored.revision, expected.revision);
  assert.equal(restored.remainingMs, expected.remainingMs - 1_000);
  assert.equal(restored.voteTotal, expected.voteTotal);
  store.close();
});

test('start with chosen mode changes session to live or demo', () => {
  const { store, service } = fixture();
  service.execute('start', { mode: 'live' });
  assert.equal(service.getState().mode, 'live');
  assert.equal(service.getState().phase, 'voting');
  store.close();
});

test('start with unknown command is rejected', () => {
  const { store, service } = fixture();
  assert.throws(() => service.execute('destroy-all'), { code: 'UNKNOWN_COMMAND' });
  store.close();
});

test('duplicate actor vote is ignored even with a new EventSub delivery id', () => {
  const { store, service } = fixture();
  service.execute('start');
  const first = service.submitVote({ optionId: 'wildflower-strip', actorId: 'viewer-1', deliveryId: 'delivery-1' });
  const second = service.submitVote({ optionId: 'wildflower-strip', actorId: 'viewer-1', deliveryId: 'delivery-2' });
  assert.equal(first.committed, true);
  assert.deepEqual(second, { committed: false, reason: 'duplicate-vote' });
  assert.equal(service.getState().voteTotal, 1);
  store.close();
});

test('duplicate delivery id is ignored even from another actor', () => {
  const { store, service } = fixture();
  service.execute('start');
  service.submitVote({ optionId: 'wildflower-strip', actorId: 'viewer-1', deliveryId: 'same-event' });
  const second = service.submitVote({ optionId: 'lighter-mowing', actorId: 'viewer-2', deliveryId: 'same-event' });
  assert.deepEqual(second, { committed: false, reason: 'duplicate-delivery' });
  assert.equal(service.getState().voteTotal, 1);
  store.close();
});

test('different actors can vote and counts aggregate without names in public state', () => {
  const { store, service } = fixture();
  service.execute('start');
  service.submitVote({ optionId: 'wildflower-strip', actorId: 'viewer-a', deliveryId: 'e1' });
  service.submitVote({ optionId: 'lighter-mowing', actorId: 'viewer-b', deliveryId: 'e2' });
  const json = JSON.stringify(service.getState());
  assert.equal(service.getState().voteTotal, 2);
  assert.equal(json.includes('viewer-a'), false);
  assert.equal(json.includes('viewer-b'), false);
  store.close();
});

test('chat event maps option number to the current round, not a hard-coded option', () => {
  const { store, service } = fixture({ mode: 'live' });
  service.execute('start', { mode: 'live' });
  service.execute('close-round');
  service.execute('select-choice', { choiceId: 'wildflower-strip' });
  service.execute('approve-choice');
  const result = service.handleChatEvent({ text: '!habitat 2', actorId: '42', deliveryId: 'evt-2' });
  assert.equal(result.committed, true);
  assert.equal(service.getState().votes['protect-soil'], 1);
  store.close();
});

test('chat handler ignores non-live events and non-vote text', () => {
  const { store, service } = fixture();
  service.execute('start');
  assert.equal(service.handleChatEvent({ text: '!habitat 1', actorId: 'a', deliveryId: 'd' }).reason, 'not-live');
  service.execute('reset', { mode: 'live' });
  service.execute('start');
  assert.equal(service.handleChatEvent({ text: 'hello everyone', actorId: 'a', deliveryId: 'd' }).reason, 'not-a-vote');
  store.close();
});

test('chat handler rejects malformed and oversized identity/delivery fields', () => {
  const { store, service } = fixture({ mode: 'live' });
  service.execute('start');
  assert.equal(service.handleChatEvent({ text: '!habitat 1', actorId: '', deliveryId: 'd' }).reason, 'invalid-event');
  assert.equal(service.handleChatEvent({ text: '!habitat 1', actorId: 'a', deliveryId: 'x'.repeat(201) }).reason, 'invalid-event');
  store.close();
});

test('chat command rejects option numbers outside allowed set', () => {
  const { store, service } = fixture({ mode: 'live' });
  service.execute('start');
  assert.equal(service.handleChatEvent({ text: '!habitat 3', actorId: 'a', deliveryId: 'd' }).reason, 'not-a-vote');
  store.close();
});

test('sample votes are demo-only, bounded, and use distinct synthetic actors', () => {
  const { store, service } = fixture();
  service.execute('start');
  const result = service.execute('sample-votes', { counts: [4,3] });
  assert.equal(result.accepted, 7);
  assert.equal(service.getState().voteTotal, 7);
  assert.equal(service.getState().votes['wildflower-strip'], 4);
  store.close();
});

test('sample vote validation rejects malformed totals', () => {
  const { store, service } = fixture();
  service.execute('start');
  for (const counts of [[-1,0],[13,0],[10,11],[1],[1,1,1],[1.2,2], 'bad']) {
    assert.throws(() => service.execute('sample-votes', { counts }), { code: 'INVALID_SAMPLE' });
  }
  store.close();
});

test('sample votes are rejected outside a voting phase and in live mode', () => {
  const demo = fixture();
  assert.throws(() => demo.service.execute('sample-votes'), { code: 'INVALID_PHASE' });
  demo.store.close();
  const live = fixture({ mode: 'live' });
  live.service.execute('start');
  assert.throws(() => live.service.execute('sample-votes'), { code: 'DEMO_ONLY' });
  live.store.close();
});

test('full service flow persists all phases and can be replayed from event ledger', () => {
  const { store, service } = fixture();
  service.execute('start');
  for (let i=0;i<3;i+=1) {
    const round = service.getState().round;
    service.execute('sample-votes', { counts: [2,1] });
    service.execute('close-round');
    service.execute('approve-choice', { choiceId: i === 2 ? 'seasonal-diversity' : round.options[0].id });
  }
  assert.equal(service.getState().phase, 'complete');
  assert.equal(service.getState().history.length, 3);
  assert.ok(service.getEvents().some((event) => event.type === 'choice-committed'));
  store.close();
});

test('reset creates a fresh session and clears identity dedupe for old session', () => {
  const { store, service } = fixture();
  service.execute('start');
  const oldId = service.getState().id;
  service.submitVote({ optionId: 'wildflower-strip', actorId: 'viewer', deliveryId: 'd1' });
  service.execute('reset', { mode: 'demo' });
  assert.notEqual(service.getState().id, oldId);
  assert.equal(service.getState().phase, 'ready');
  assert.equal(service.getState().voteTotal, 0);
  store.close();
});

test('reset event does not include chat identities or raw message text', () => {
  const { store, service } = fixture();
  service.execute('start');
  service.submitVote({ optionId: 'wildflower-strip', actorId: 'private-login', deliveryId: 'd1' });
  service.execute('reset');
  const allEvents = store.db.prepare('SELECT payload_json FROM events').all().map((r)=>r.payload_json).join(' ');
  assert.equal(allEvents.includes('private-login'), false);
  assert.equal(allEvents.includes('!habitat'), false);
  store.close();
});

test('export recap contains aggregate outcomes and never raw voter IDs', () => {
  const { store, service } = fixture();
  service.execute('start');
  service.submitVote({ optionId: 'wildflower-strip', actorId: 'secret-user', deliveryId: 'd1' });
  service.execute('close-round');
  service.execute('approve-choice');
  const exportText = JSON.stringify(service.exportRecap());
  assert.equal(exportText.includes('secret-user'), false);
  assert.match(exportText, /not ecological measurements/);
  assert.equal(service.exportRecap().rounds[0].votes['wildflower-strip'], 1);
  assert.equal(service.exportRecap().rounds[0].resourceCost, 2);
  assert.equal(service.exportRecap().rounds[0].budgetAfter, 4);
  assert.equal(service.exportRecap().fictionalTokensRemaining, 4);
  assert.match(service.exportRecapMarkdown(), /Fictional field tokens used: 2; remaining after this choice: 4/);
  store.close();
});

test('expireRound closes only when timer has elapsed', () => {
  let now = 1000;
  const store = new Store(':memory:');
  const service = new HabitatService({ store, now: () => now, voteSalt: 'salt', roundDurationMs: 1000 });
  service.execute('start');
  assert.equal(service.expireRound(), false);
  now = 2000;
  assert.equal(service.expireRound(), true);
  assert.equal(service.getState().phase, 'review');
  store.close();
});

test('service emits a safe update on committed state changes', async () => {
  const { store, service } = fixture();
  const update = new Promise((resolve) => service.once('update', resolve));
  service.execute('start');
  const message = await update;
  assert.equal(message.type, 'state');
  assert.equal(message.data.phase, 'voting');
  store.close();
});

test('repeat sample audience is idempotent per synthetic viewer and session', () => {
  const { store, service } = fixture();
  service.execute('start');
  assert.equal(service.execute('sample-votes', { counts: [2, 2] }).accepted, 4);
  assert.equal(service.execute('sample-votes', { counts: [2, 2] }).accepted, 0);
  assert.equal(service.getState().voteTotal, 4);
  assert.equal(service.getState().resourceBudget, 6, 'votes do not spend fictional resources');
  store.close();
});

test('undo and discard are persisted as privacy-safe operator events', () => {
  const { store, service } = fixture();
  service.execute('start');
  service.execute('close-round');
  service.execute('select-choice', { choiceId: 'wildflower-strip' });
  service.execute('approve-choice');
  assert.equal(service.getOperatorState().canUndoLastChoice, true);
  service.execute('undo-last-choice');
  service.execute('discard-round');
  const events = service.getEvents();
  assert.ok(events.some((event) => event.type === 'choice-undone'));
  assert.ok(events.some((event) => event.type === 'round-discarded'));
  assert.equal(JSON.stringify(events).includes('actor'), false);
  assert.equal(service.getState().roundIndex, 1);
  store.close();
});

test('action views are aggregate-only, available after completion, and Markdown recap is anonymized', () => {
  const { store, service } = fixture();
  assert.throws(() => service.recordActionViewed('ivn-wildlife-friendly-garden'), { code: 'ACTION_UNAVAILABLE' });
  service.execute('start');
  for (let i = 0; i < 3; i += 1) {
    service.execute('close-round');
    service.execute('select-choice', { choiceId: i === 2 ? 'seasonal-diversity' : service.getState().round.options[0].id });
    service.execute('approve-choice');
  }
  service.recordActionViewed('ivn-wildlife-friendly-garden');
  const events = service.getEvents();
  const viewed = events.find((event) => event.type === 'final-action-viewed');
  assert.deepEqual(viewed.payload, { actionId: 'ivn-wildlife-friendly-garden' });
  const markdown = service.exportRecapMarkdown();
  assert.match(markdown, /Simulation, not measured restoration/);
  assert.match(markdown, /Optional next step/);
  assert.match(markdown, /ivn\.nl/);
  assert.doesNotMatch(markdown, /chatterLogin|viewer-id|raw chat/i);
  store.close();
});

test('monotonic deadline is unaffected by wall-clock jumps and pause preserves server-measured time', () => {
  let wall = 1_000;
  let monotonic = 10;
  const store = new Store(':memory:');
  const service = new HabitatService({ store, now: () => wall, monotonicNow: () => monotonic, voteSalt: 'salt', roundDurationMs: 10_000 });
  service.execute('start');
  wall = 9_000_000_000;
  monotonic += 1_500;
  assert.equal(service.expireRound(), false);
  assert.equal(service.getState().remainingMs, 8_500);
  service.execute('pause');
  const paused = service.getState();
  assert.equal(paused.remainingMs, 8_500);
  wall = 0;
  monotonic += 200;
  assert.equal(service.getState().remainingMs, 8_500);
  store.close();
});

test('hydration migrates missing fictional-budget state from committed history', () => {
  const store = new Store(':memory:');
  let service = new HabitatService({ store, now: () => 1_000, voteSalt: 'migration-test' });
  service.execute('start');
  service.execute('close-round');
  service.execute('select-choice', { choiceId: 'wildflower-strip' });
  service.execute('approve-choice');
  const legacy = {
    ...service.rawState,
    resourceBudget: undefined,
    history: service.rawState.history.map(({ budgetBefore, budgetAfter, ...entry }) => entry),
  };
  assert.equal(store.commitState(legacy, { type: 'legacy-state-fixture', payload: {}, createdAt: 1_001 }).committed, true);
  service = new HabitatService({ store, now: () => 1_002, voteSalt: 'migration-test' });
  assert.equal(service.getState().resourceBudget, 4);
  store.close();
});
