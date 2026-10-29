import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, ROUND_DURATION_MS, TEAM_GOAL, GameRuleError, createGameState, reduceGame, makeSnapshot, remainingMs } from '../src/domain/game.js';

const at = 1_800_000_000_000;
function start() { return reduceGame(createGameState({ sessionId: 'session-a', mode: 'demo', now: at }), { type: 'START', now: at }); }

test('new round opens with three equal-value choices and a fixed 180-second window', () => {
  const state = start();
  assert.equal(state.phase, 'active'); assert.equal(state.round, 1); assert.equal(state.deadlineAt, at + ROUND_DURATION_MS);
  assert.equal(ROUND_DURATION_MS, 180_000); assert.equal(TEAM_GOAL, 12);
  assert.deepEqual(ACTIONS.map((action) => action.chatCommand), ['!help 1', '!help 2', '!help 3']);
  assert.deepEqual(Object.values(state.counts), [0, 0, 0]);
});

test('each valid input increments the same shared meter once, with source-local totals', () => {
  let state = start();
  state = reduceGame(state, { type: 'CONTRIBUTE', now: at + 1, round: 1, source: 'twitch', actionId: 'flowers' });
  state = reduceGame(state, { type: 'CONTRIBUTE', now: at + 2, round: 1, source: 'companion', actionId: 'water' });
  assert.equal(state.total, 2); assert.equal(state.counts.flowers, 1); assert.equal(state.counts.water, 1); assert.equal(state.sourceCounts.twitch, 1); assert.equal(state.sourceCounts.companion, 1);
  const snapshot = makeSnapshot(state, at + 2); assert.equal(snapshot.total, 2); assert.equal(snapshot.sourceCounts.chat, 1); assert.equal(snapshot.sourceCounts.companion, 1);
});

test('pause freezes remaining server time and resume shifts the deadline', () => {
  const state = start(); const pausedAt = at + 37_500; const paused = reduceGame(state, { type: 'PAUSE', now: pausedAt });
  assert.equal(paused.phase, 'paused'); assert.equal(paused.deadlineAt, null); assert.equal(paused.pausedRemainingMs, ROUND_DURATION_MS - 37_500); assert.equal(remainingMs(paused, pausedAt + 500_000), ROUND_DURATION_MS - 37_500);
  const resumedAt = pausedAt + 500_000; const resumed = reduceGame(paused, { type: 'RESUME', now: resumedAt });
  assert.equal(resumed.phase, 'active'); assert.equal(resumed.deadlineAt, resumedAt + ROUND_DURATION_MS - 37_500);
});

test('expired time and streamer close reveal aggregate outcomes without early completion', () => {
  let state = start();
  for (let i = 0; i < 12; i++) state = reduceGame(state, { type: 'CONTRIBUTE', now: at + 100 + i, round: 1, source: i % 2 ? 'companion' : 'twitch', actionId: ACTIONS[i % 3].id });
  assert.equal(state.phase, 'active'); assert.equal(state.total, TEAM_GOAL);
  const complete = reduceGame(state, { type: 'TICK', now: at + ROUND_DURATION_MS });
  assert.equal(complete.phase, 'revealed'); assert.equal(complete.outcome.completed, true); assert.match(complete.outcome.text, /shared goal/);
  let partial = start(); partial = reduceGame(partial, { type: 'CONTRIBUTE', now: at + 5, round: 1, source: 'companion', actionId: 'shade' });
  partial = reduceGame(partial, { type: 'CLOSE_ROUND', now: at + 50 });
  assert.equal(partial.phase, 'revealed'); assert.equal(partial.outcome.completed, false); assert.equal(partial.total, 1);
});

test('no contribution can depend on speed; late, paused, wrong-round, and invalid actions fail closed', () => {
  let state = start();
  assert.throws(() => reduceGame(state, { type: 'CONTRIBUTE', now: at + ROUND_DURATION_MS, round: 1, source: 'twitch', actionId: 'flowers' }), (error) => error.code === 'ROUND_CLOSED');
  assert.throws(() => reduceGame(state, { type: 'CONTRIBUTE', now: at + 2, round: 2, source: 'twitch', actionId: 'flowers' }), (error) => error.code === 'STALE_ROUND');
  assert.throws(() => reduceGame(state, { type: 'CONTRIBUTE', now: at + 2, round: 1, source: 'twitch', actionId: 'not-a-choice' }), (error) => error.code === 'INVALID_ACTION');
  state = reduceGame(state, { type: 'PAUSE', now: at + 1 });
  assert.throws(() => reduceGame(state, { type: 'CONTRIBUTE', now: at + 2, round: 1, source: 'companion', actionId: 'flowers' }), (error) => error.code === 'ROUND_NOT_OPEN');
  assert.equal(state.total, 0);
});

test('next round starts with cleared counts; end session is closed and immutable to game controls', () => {
  let state = start(); state = reduceGame(state, { type: 'CLOSE_ROUND', now: at + 100 });
  state = reduceGame(state, { type: 'START', now: at + 200 });
  assert.equal(state.round, 2); assert.equal(state.phase, 'active'); assert.equal(state.total, 0);
  state = reduceGame(state, { type: 'END_SESSION', now: at + 300 }); assert.equal(state.phase, 'closed');
  assert.throws(() => reduceGame(state, { type: 'START', now: at + 400 }), GameRuleError);
});
