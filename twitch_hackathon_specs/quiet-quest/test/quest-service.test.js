import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { QuestService } from '../src/application/quest-service.js';
import { ACTIONS } from '../src/domain/game.js';

function setup() { let time = 1_800_000_000_000; const store = new SqliteStore(':memory:'); let notifications = 0; const service = new QuestService({ store, secret: 'test-secret-with-at-least-32-characters-long', clock: () => time, onChange: () => { notifications++; } }); return { store, service, setTime: (value) => { time = value; }, get notifications() { return notifications; } }; }

test('start creates an active three-minute session and a high-entropy revocable companion invite', () => {
  const { store, service } = setup(); const created = service.start('demo');
  assert.equal(created.session.state.phase, 'active'); assert.equal(created.session.state.mode, 'demo'); assert.match(created.code, /^[A-Za-z0-9_-]{27}$/);
  assert.equal(service.resolveInvite(created.code).id, created.session.id);
  assert.equal(service.snapshot(created.session.id).connectionState, 'simulated');
  store.close();
});

test('one contribution per identity per round is enforced per source, independent of action or message speed', () => {
  const { store, service } = setup(); const { session, code } = service.start('demo');
  const chat = service.contribute({ sessionId: session.id, round: 1, source: 'twitch', identity: 'simulator:sample-1', actionId: 'flowers', deliveryId: 'message-1' });
  assert.equal(chat.accepted, true); assert.equal(chat.session.state.total, 1);
  const duplicateActor = service.contribute({ sessionId: session.id, round: 1, source: 'twitch', identity: 'simulator:sample-1', actionId: 'water', deliveryId: 'message-2' });
  assert.equal(duplicateActor.accepted, false); assert.equal(duplicateActor.reason, 'already-contributed');
  const duplicateDelivery = service.contribute({ sessionId: session.id, round: 1, source: 'twitch', identity: 'simulator:sample-2', actionId: 'shade', deliveryId: 'message-1' });
  assert.equal(duplicateDelivery.accepted, false); assert.equal(duplicateDelivery.reason, 'duplicate-delivery');
  const samePersonOtherRoute = service.contribute({ sessionId: session.id, round: 1, source: 'companion', identity: 'simulator:sample-1', actionId: 'water' });
  assert.equal(samePersonOtherRoute.accepted, true); assert.equal(samePersonOtherRoute.session.state.total, 2);
  assert.ok(service.resolveInvite(code)); store.close();
});

test('Twitch identifiers are keyed and salted before persistence; no display name or raw message is stored', () => {
  const { store, service } = setup(); const { session } = service.start('live');
  service.contribute({ sessionId: session.id, round: 1, source: 'twitch', identity: '12345678901234567890', actionId: 'flowers', deliveryId: 'twitch-message-1' });
  const row = store.db.prepare('SELECT actor_key FROM contributions WHERE session_id=?').get(session.id);
  assert.match(row.actor_key, /^[a-f0-9]{64}$/); assert.notEqual(row.actor_key, '12345678901234567890');
  const schema = store.db.prepare('PRAGMA table_info(contributions)').all().map((item) => item.name);
  assert.equal(schema.includes('display_name'), false); assert.equal(schema.includes('raw_message'), false);
  assert.equal(JSON.stringify(store.events(session.id)).includes('12345678901234567890'), false); store.close();
});

test('paused time is preserved, expiry reveals the result, and no command is accepted after closure', () => {
  const { store, service, setTime } = setup(); const { session } = service.start('demo');
  service.contribute({ sessionId: session.id, round: 1, source: 'companion', identity: 'cookie-nonce', actionId: 'shade' });
  setTime(1_800_000_010_000); const paused = service.control(session.id, 'PAUSE');
  assert.equal(paused.state.phase, 'paused'); const remaining = paused.state.pausedRemainingMs;
  setTime(1_800_000_500_000); const resumed = service.control(session.id, 'RESUME');
  assert.equal(resumed.state.deadlineAt, 1_800_000_500_000 + remaining);
  setTime(resumed.state.deadlineAt); const expired = service.get(session.id);
  assert.equal(expired.state.phase, 'revealed'); assert.equal(expired.state.outcome.contributions, 1);
  const next = service.nextRound(session.id); assert.equal(next.state.round, 2); assert.equal(next.state.total, 0);
  service.control(session.id, 'END_SESSION');
  assert.equal(service.contribute({ sessionId: session.id, round: 2, source: 'twitch', identity: 'user', actionId: ACTIONS[0].id }).accepted, false);
  store.close();
});

test('rotating or disabling a companion invite prevents new joins and companion input', () => {
  const { store, service } = setup(); const created = service.start('demo'); const next = service.invite(created.session.id);
  assert.equal(service.resolveInvite(created.code), null); assert.ok(service.resolveInvite(next));
  service.setCompanion(created.session.id, false);
  assert.equal(service.resolveInvite(next), null);
  assert.equal(service.contribute({ sessionId: created.session.id, round: 1, source: 'companion', identity: 'browser', actionId: 'flowers' }).reason, 'companion-disabled'); store.close();
});

test('new session round recaps contain aggregate data only and retain completed prior rounds', () => {
  const { store, service, setTime } = setup(); const { session } = service.start('demo');
  for (let i = 0; i < 3; i++) service.contribute({ sessionId: session.id, round: 1, source: i % 2 ? 'companion' : 'twitch', identity: `simulator:sample-${i}`, actionId: ACTIONS[i].id });
  service.control(session.id, 'CLOSE_ROUND'); service.nextRound(session.id);
  service.contribute({ sessionId: session.id, round: 2, source: 'companion', identity: 'browser-1', actionId: 'flowers' });
  const recap = service.history(); assert.equal(recap.length, 2);
  assert.equal(recap.find((row) => row.snapshot.round === 1).snapshot.total, 3);
  assert.equal(recap.find((row) => row.snapshot.round === 2).snapshot.total, 1);
  assert.equal(JSON.stringify(recap).includes('sample-0'), false); assert.equal(recap.every((row) => !('events' in row)), true); setTime(1_800_000_000_001); store.close();
});
