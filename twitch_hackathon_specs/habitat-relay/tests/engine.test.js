import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveChoice, canUndoLastChoice, castVote, closeRoundEarly, closeVoting, createSession, currentRound, discardRound,
  pauseSession, publicState, resumeSession, selectPendingChoice, startSession, undoLastChoice, validateState,
} from '../src/domain/engine.js';
import { INITIAL_METRICS, ROUNDS } from '../src/domain/scenario.js';

const start = (now = 1_000, duration = 5_000) => startSession(createSession({ id: 'test-session', now }), { now, roundDurationMs: duration });
const voteAll = (state, optionId, count, now = 1_500) => { for (let i=0;i<count;i+=1) state = castVote(state, optionId, { now }); return state; };

test('initial state is ready, stable, and starts from copied base metrics', () => {
  const state = createSession({ id: 'a', now: 123 });
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.metrics, INITIAL_METRICS);
  assert.notEqual(state.metrics, INITIAL_METRICS);
  assert.equal(state.revision, 0);
  assert.equal(state.id, 'a');
  assert.equal(state.createdAt, 123);
});

test('rejects invalid session mode', () => assert.throws(() => createSession({ mode: 'production' }), { code: 'INVALID_MODE' }));

test('starts first voting round with correct options and a server deadline', () => {
  const state = start(1_000, 6_000);
  assert.equal(state.phase, 'voting');
  assert.equal(state.roundIndex, 0);
  assert.equal(state.roundClosesAt, 7_000);
  assert.deepEqual(state.votes, { 'wildflower-strip': 0, 'lighter-mowing': 0 });
  assert.equal(currentRound(state).id, 'flowers');
});

test('cannot start a session twice', () => assert.throws(() => startSession(start()), { code: 'INVALID_PHASE' }));

test('round duration bounds reject zero, too short, too long, and non-finite values', () => {
  for (const value of [0, 999, 1_800_001, Infinity, NaN]) assert.throws(() => startSession(createSession(), { roundDurationMs: value }), { code: 'INVALID_DURATION' });
});

test('accepts an in-window vote and does not mutate its input object', () => {
  const before = start();
  const next = castVote(before, 'wildflower-strip', { now: 1_001 });
  assert.deepEqual(before.votes, { 'wildflower-strip': 0, 'lighter-mowing': 0 });
  assert.equal(next.votes['wildflower-strip'], 1);
  assert.equal(next.revision, before.revision + 1);
});

test('rejects vote exactly at deadline', () => assert.throws(() => castVote(start(), 'wildflower-strip', { now: 6_000 }), { code: 'ROUND_CLOSED' }));

test('rejects votes before session starts, during review, after complete, and while paused', () => {
  const ready = createSession();
  assert.throws(() => castVote(ready, 'wildflower-strip'), { code: 'INVALID_PHASE' });
  let review = closeRoundEarly(start());
  assert.throws(() => castVote(review, 'wildflower-strip'), { code: 'INVALID_PHASE' });
  const paused = pauseSession(start());
  assert.throws(() => castVote(paused, 'wildflower-strip'), { code: 'INVALID_PHASE' });
});

test('rejects an option not belonging to current round', () => assert.throws(() => castVote(start(1_000, 10_000), 'retain-deadwood', { now: 1_001 }), { code: 'INVALID_OPTION' }));

test('requires timer expiry for scheduled close', () => assert.throws(() => closeVoting(start(), { now: 1_001 }), { code: 'ROUND_STILL_OPEN' }));

test('scheduled close at deadline enters review and selects unique plurality', () => {
  const state = voteAll(start(), 'wildflower-strip', 3);
  const review = closeVoting(state, { now: state.roundClosesAt });
  assert.equal(review.phase, 'review');
  assert.equal(review.voteOutcome, 'plurality');
  assert.equal(review.pendingChoiceId, 'wildflower-strip');
});

test('operator can close early and preserve vote tally', () => {
  const state = voteAll(start(), 'lighter-mowing', 2);
  const review = closeRoundEarly(state, { now: 2_000 });
  assert.equal(review.phase, 'review');
  assert.equal(review.votes['lighter-mowing'], 2);
  assert.equal(review.voteOutcome, 'plurality');
});

test('tie is reported without arbitrary random winner', () => {
  let state = start();
  state = castVote(state, 'wildflower-strip', { now: 1_200 });
  state = castVote(state, 'lighter-mowing', { now: 1_300 });
  const review = closeRoundEarly(state, { now: 2_000 });
  assert.equal(review.voteOutcome, 'tie');
  assert.equal(review.pendingChoiceId, null);
  assert.deepEqual(new Set(review.tieOptionIds), new Set(['wildflower-strip', 'lighter-mowing']));
});

test('zero votes require a streamer-selected path', () => {
  const review = closeRoundEarly(start(), { now: 2_000 });
  assert.equal(review.voteOutcome, 'no-votes');
  assert.equal(review.pendingChoiceId, null);
  assert.throws(() => approveChoice(review), { code: 'CHOICE_REQUIRED' });
});

test('selected choice must be valid for current round', () => {
  const review = closeRoundEarly(start());
  assert.throws(() => selectPendingChoice(review, 'connect-patches'), { code: 'INVALID_OPTION' });
});

test('streamer can resolve a tie and approve selected option', () => {
  let state = start();
  state = castVote(state, 'wildflower-strip', { now: 1_200 });
  state = castVote(state, 'lighter-mowing', { now: 1_300 });
  state = closeRoundEarly(state, { now: 2_000 });
  state = selectPendingChoice(state, 'lighter-mowing', { now: 2_100 });
  const next = approveChoice(state, { now: 2_200 });
  assert.equal(next.history[0].choiceId, 'lighter-mowing');
  assert.equal(next.phase, 'voting');
  assert.equal(next.roundIndex, 1);
  assert.equal(next.votes['retain-deadwood'], 0);
});

test('unique plurality remains pending for explicit streamer approval', () => {
  let state = voteAll(start(), 'wildflower-strip', 4);
  state = castVote(state, 'lighter-mowing', { now: 1_700 });
  state = closeRoundEarly(state);
  assert.equal(state.phase, 'review');
  assert.equal(state.pendingChoiceId, 'wildflower-strip');
  assert.equal(state.metrics.forage, INITIAL_METRICS.forage);
});

test('approval applies bounded effects and writes attribution data', () => {
  const state = approveChoice(closeRoundEarly(voteAll(start(), 'wildflower-strip', 1)), { now: 2_000 });
  assert.equal(state.metrics.forage, INITIAL_METRICS.forage + 22);
  assert.equal(state.metrics.diversity, INITIAL_METRICS.diversity + 8);
  assert.equal(state.history[0].sourceId, 'eea-pollinator-habitats-2025');
  assert.equal(state.history[0].choiceLabel, 'Wildflower strips');
});

test('approval advances exactly one round and clears current votes', () => {
  const review = closeRoundEarly(start());
  const state = approveChoice(selectPendingChoice(review, 'wildflower-strip'), { now: 2_000 });
  assert.equal(state.roundIndex, 1);
  assert.deepEqual(state.votes, { 'retain-deadwood': 0, 'protect-soil': 0 });
  assert.equal(state.history.length, 1);
  assert.equal(state.phase, 'voting');
});

test('full three-round flow reaches complete with final metrics and timestamp', () => {
  let state = start();
  for (let i=0;i<ROUNDS.length;i+=1) {
    const round = currentRound(state);
    state = castVote(state, round.options[i % round.options.length].id, { now: 1_100 + i });
    state = closeRoundEarly(state, { now: 2_000 + i });
    state = approveChoice(state, { now: 2_500 + i });
  }
  assert.equal(state.phase, 'complete');
  assert.equal(state.history.length, 3);
  assert.equal(state.completedAt, 2_502);
  assert.equal(state.roundClosesAt, null);
  assert.equal(currentRound(state), null);
});

test('metric changes clamp at 100', () => {
  let state = start();
  state = { ...state, metrics: { forage: 95, nesting: 97, connectivity: 98, diversity: 99, resilience: 100 } };
  state = closeRoundEarly(state);
  state = selectPendingChoice(state, 'wildflower-strip');
  state = approveChoice(state);
  for (const score of Object.values(state.metrics)) assert.ok(score <= 100);
});

test('pause captures remaining time and resume shifts deadline', () => {
  const state = start(1_000, 10_000);
  const paused = pauseSession(state, { now: 4_000 });
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.pausedFrom, 'voting');
  assert.equal(paused.remainingMs, 7_000);
  const resumed = resumeSession(paused, { now: 50_000 });
  assert.equal(resumed.phase, 'voting');
  assert.equal(resumed.roundClosesAt, 57_000);
  assert.equal(resumed.pausedFrom, null);
});

test('pausing after the deadline preserves zero time', () => {
  const paused = pauseSession(start(1_000, 2_000), { now: 9_000 });
  assert.equal(paused.remainingMs, 0);
});

test('pause and resume preserve review decision and votes', () => {
  let state = closeRoundEarly(voteAll(start(), 'wildflower-strip', 2));
  state = pauseSession(state, { now: 2_000 });
  state = resumeSession(state, { now: 3_000 });
  assert.equal(state.phase, 'review');
  assert.equal(state.pendingChoiceId, 'wildflower-strip');
  assert.equal(state.votes['wildflower-strip'], 2);
});

test('cannot pause ready or completed sessions', () => {
  assert.throws(() => pauseSession(createSession()), { code: 'INVALID_PHASE' });
  let state = start();
  for (let i=0;i<3;i+=1) { state=closeRoundEarly(state); state=selectPendingChoice(state,i===2?'seasonal-diversity':currentRound(state).options[0].id); state=approveChoice(state); }
  assert.throws(() => pauseSession(state), { code: 'INVALID_PHASE' });
});

test('public state excludes no private actor fields and is detached from internal state', () => {
  const internal = start();
  internal.internalActorIds = ['must-not-leak'];
  const output = publicState(internal);
  assert.equal('internalActorIds' in output, false);
  output.metrics.forage = 100;
  assert.notEqual(internal.metrics.forage, 100);
});

test('public state has only current public option metadata', () => {
  const state = publicState(start());
  assert.deepEqual(state.round.options.map((o)=>o.id), ['wildflower-strip','lighter-mowing']);
  assert.equal('effects' in state.round.options[0], false);
});

test('state validator accepts valid ready, voting, review, paused, and complete states', () => {
  assert.equal(validateState(createSession()), true);
  let state = start(); assert.equal(validateState(state), true);
  state = closeRoundEarly(state); assert.equal(validateState(state), true);
  state = pauseSession(state); assert.equal(validateState(state), true);
  state = resumeSession(state); state = selectPendingChoice(state,'wildflower-strip'); state=approveChoice(state); assert.equal(validateState(state), true);
  for (let i=0;i<2;i+=1) { state=closeRoundEarly(state); state=selectPendingChoice(state,i===1?'seasonal-diversity':currentRound(state).options[0].id); state=approveChoice(state); }
  assert.equal(validateState(state), true);
});

test('state validator rejects bad schemas, phase, index, metrics, and tallies', () => {
  const base = createSession();
  for (const changed of [
    { ...base, schemaVersion: 2 }, { ...base, phase: 'unknown' }, { ...base, roundIndex: -1 },
    { ...base, metrics: { ...base.metrics, forage: 101 } }, { ...base, metrics: { ...base.metrics, forage: NaN } },
    { ...base, resourceBudget: -1 }, { ...base, resourceBudget: 6.5 },
    { ...base, history: Array(4).fill({}) },
  ]) assert.throws(() => validateState(changed), { code: 'INVALID_STATE' });
});

test('state validator rejects malformed voting state and negative tally', () => {
  const state = start();
  assert.throws(() => validateState({ ...state, roundClosesAt: null }), { code: 'INVALID_STATE' });
  assert.throws(() => validateState({ ...state, votes: { ...state.votes, 'wildflower-strip': -1 } }), { code: 'INVALID_STATE' });
  assert.throws(() => validateState({ ...state, votes: { fake: 1 } }), { code: 'INVALID_STATE' });
});

test('undo reopens the last committed choice only before the next round receives votes', () => {
  let state = closeRoundEarly(start());
  state = selectPendingChoice(state, 'wildflower-strip');
  state = approveChoice(state, { now: 2_500 });
  assert.equal(canUndoLastChoice(state), true);
  const undone = undoLastChoice(state, { now: 2_600 });
  assert.equal(undone.phase, 'review');
  assert.equal(undone.roundIndex, 0);
  assert.equal(undone.pendingChoiceId, 'wildflower-strip');
  assert.equal(undone.metrics.forage, INITIAL_METRICS.forage);
  assert.equal(undone.history.length, 0);
  state = castVote(state, 'retain-deadwood', { now: 2_700 });
  assert.equal(canUndoLastChoice(state), false);
  assert.throws(() => undoLastChoice(state), { code: 'UNDO_UNSAFE' });
});

test('undo restores the last-round choice after completion with prior metric snapshot', () => {
  let state = start();
  for (let i = 0; i < ROUNDS.length; i += 1) {
    state = closeRoundEarly(state, { now: 2_000 + i });
    state = selectPendingChoice(state, i === 2 ? 'seasonal-diversity' : currentRound(state).options[0].id, { now: 2_100 + i });
    state = approveChoice(state, { now: 2_200 + i });
  }
  assert.equal(state.phase, 'complete');
  assert.equal(canUndoLastChoice(state), true);
  const restored = undoLastChoice(state, { now: 3_000 });
  assert.equal(restored.phase, 'review');
  assert.equal(restored.roundIndex, 2);
  assert.equal(restored.history.length, 2);
  assert.deepEqual(restored.metrics, state.history[1].metricsAfter);
  assert.equal(restored.completedAt, null);
});

test('discard skips a voting round without applying effects and records aggregate count', () => {
  const open = voteAll(start(), 'wildflower-strip', 3);
  const discarded = discardRound(open, { now: 2_000, roundDurationMs: 4_000 });
  assert.equal(discarded.phase, 'voting');
  assert.equal(discarded.roundIndex, 1);
  assert.deepEqual(discarded.metrics, INITIAL_METRICS);
  assert.deepEqual(discarded.skippedRounds, [{ roundId: 'flowers', roundNumber: 1, discardedAt: 2_000, voteTotal: 3 }]);
  assert.equal(discarded.roundClosesAt, 6_000);
  assert.equal(discarded.history.length, 0);
  assert.equal(validateState(discarded), true);
});

test('discarding the final round safely completes a scenario with a skipped stop', () => {
  let state = start();
  state = discardRound(state, { now: 1_500 });
  state = discardRound(state, { now: 1_600 });
  const completed = discardRound(state, { now: 1_700 });
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.roundIndex, ROUNDS.length);
  assert.equal(completed.history.length, 0);
  assert.equal(completed.skippedRounds.length, 3);
  assert.deepEqual(completed.metrics, INITIAL_METRICS);
  assert.equal(validateState(completed), true);
});

test('public overlay state does not expose operator undo capability or actor identity', () => {
  let state = closeRoundEarly(start());
  state = selectPendingChoice(state, 'wildflower-strip');
  state = approveChoice(state);
  const snapshot = publicState(state);
  assert.equal('canUndoLastChoice' in snapshot, false);
  assert.equal('metricsBefore' in snapshot.history[0], false);
  assert.deepEqual(snapshot.skippedRounds, []);
});

test('streamer-approved choice consumes its fictional resource cost exactly once', () => {
  let state = closeRoundEarly(start());
  state = selectPendingChoice(state, 'wildflower-strip');
  const approved = approveChoice(state, { now: 2_100 });
  assert.equal(approved.resourceBudget, 4);
  assert.equal(approved.history[0].resourceCost, 2);
  assert.equal(approved.history[0].budgetBefore, 6);
  assert.equal(approved.history[0].budgetAfter, 4);
  assert.throws(() => approveChoice(approved), { code: 'INVALID_PHASE' }, 'the same approval cannot spend again');
  assert.equal(approved.resourceBudget, 4);
});

test('real budget scarcity blocks an expensive final choice without mutating review, while a cheaper path remains available', () => {
  let state = start();
  for (const choiceId of ['wildflower-strip', 'retain-deadwood']) {
    state = closeRoundEarly(state);
    state = selectPendingChoice(state, choiceId);
    state = approveChoice(state);
  }
  assert.equal(state.resourceBudget, 2);
  state = closeRoundEarly(state);
  state = selectPendingChoice(state, 'connect-patches');
  assert.throws(() => approveChoice(state), { code: 'INSUFFICIENT_RESOURCES' });
  assert.equal(state.phase, 'review');
  assert.equal(state.resourceBudget, 2);
  state = selectPendingChoice(state, 'seasonal-diversity');
  state = approveChoice(state);
  assert.equal(state.phase, 'complete');
  assert.equal(state.resourceBudget, 1);
});

test('discarding a round has no metric or resource cost', () => {
  const state = discardRound(voteAll(start(), 'wildflower-strip', 1), { now: 2_000 });
  assert.equal(state.resourceBudget, 6);
  assert.deepEqual(state.metrics, INITIAL_METRICS);
});

test('undo restores the exact fictional resource balance from before the choice', () => {
  let state = closeRoundEarly(start());
  state = selectPendingChoice(state, 'wildflower-strip');
  state = approveChoice(state, { now: 2_000 });
  assert.equal(state.resourceBudget, 4);
  state = undoLastChoice(state, { now: 2_100 });
  assert.equal(state.resourceBudget, 6);
});
