import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { ViewerPoll } from '../src/application/viewer-poll.js';
import { PUBLIC_PROMPT_TEMPLATES } from '../src/domain/source-pack.js';
import { resolveVoterCookie } from '../src/adapters/security/voter-cookie.js';

const sessionId = 'a'.repeat(40);
function setup() {
  let now = new Date('2026-10-29T10:00:00.000Z');
  const store = new SqliteStore(':memory:');
  const poll = new ViewerPoll({ store, sessionId, clock: () => new Date(now) });
  return { store, poll, setNow: (value) => { now = new Date(value); } };
}

test('viewer poll only offers fixed, public, safe prompt templates', () => {
  const { poll } = setup(); const snapshot = poll.snapshot();
  assert.deepEqual(snapshot.choices.map(({ id, question }) => ({ id, question })), PUBLIC_PROMPT_TEMPLATES);
  assert.equal(snapshot.totalVotes, 0);
  assert.equal(snapshot.alreadyVoted, false);
  assert.match(snapshot.note, /nothing is published automatically/i);
});

test('one anonymous voter token can cast one vote in the rolling 24-hour window', () => {
  const { poll } = setup(); const choice = PUBLIC_PROMPT_TEMPLATES[1];
  const first = poll.cast('voter-hash-1', choice.id);
  assert.equal(first.accepted, true); assert.equal(first.totalVotes, 1); assert.equal(first.alreadyVoted, true);
  const second = poll.cast('voter-hash-1', PUBLIC_PROMPT_TEMPLATES[0].id);
  assert.equal(second.accepted, false); assert.equal(second.reason, 'already-voted');
  assert.equal(second.choices.find(({ id }) => id === choice.id).votes, 1);
  assert.throws(() => poll.cast('voter-hash-2', 'viewer-submitted-text'), (error) => error.code === 'INVALID_VOTE_CHOICE');
});

test('expired votes stop counting and the voter can vote again after 24 hours', () => {
  const { poll, setNow } = setup(); const choice = PUBLIC_PROMPT_TEMPLATES[0];
  assert.equal(poll.cast('voter-hash-expiry', choice.id).totalVotes, 1);
  setNow('2026-10-30T10:00:01.000Z');
  const snapshot = poll.snapshot('voter-hash-expiry');
  assert.equal(snapshot.totalVotes, 0); assert.equal(snapshot.alreadyVoted, false);
  assert.equal(poll.cast('voter-hash-expiry', PUBLIC_PROMPT_TEMPLATES[2].id).accepted, true);
});

test('leader selection is deterministic in a tie and null before any vote', () => {
  const { poll } = setup(); assert.equal(poll.leader(), null);
  poll.cast('one', PUBLIC_PROMPT_TEMPLATES[1].id); poll.cast('two', PUBLIC_PROMPT_TEMPLATES[0].id);
  assert.equal(poll.leader().id, PUBLIC_PROMPT_TEMPLATES[0].id);
});

test('voter token cookie is signed, HttpOnly, SameSite strict, and never contains a user identity', () => {
  const secret = 'test-voter-cookie-secret-with-at-least-32-bytes';
  const first = resolveVoterCookie(null, { secret, now: 1_800_000_000_000, secure: true });
  assert.match(first.cookie, /HttpOnly/); assert.match(first.cookie, /SameSite=Strict/); assert.match(first.cookie, /Secure/);
  assert.match(first.cookie, /Max-Age=86400/); assert.doesNotMatch(first.cookie, /viewer|name|email|login/i);
  const raw = first.cookie.match(/context_desk_voter=([^;]+)/)[1];
  const next = resolveVoterCookie(raw, { secret, now: 1_800_000_000_001 });
  assert.equal(next.cookie, null); assert.equal(next.hash, first.hash);
  const parts = raw.split('.'); const sig = parts[2]; parts[2] = `${sig[0] === '0' ? '1' : '0'}${sig.slice(1)}`;
  const tampered = resolveVoterCookie(parts.join('.'), { secret, now: 1_800_000_000_001 });
  assert.notEqual(tampered.hash, first.hash);
  assert.throws(() => resolveVoterCookie(null, { secret: 'weak' }), /strong server secret/);
});
