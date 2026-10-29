import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyEventSubSignature, EventSubReplayGuard, parseChatMessage } from '../src/adapters/twitch/eventsub.js';

function signed(rawBody, secret = 'eventsub-secret-for-tests', time = new Date('2026-10-28T12:00:00.000Z'), id = 'message-1') {
  const timestamp = time.toISOString();
  const signature = `sha256=${createHmac('sha256', secret).update(id + timestamp + rawBody).digest('hex')}`;
  return { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp, 'twitch-eventsub-message-signature': signature };
}

test('EventSub HMAC verification accepts only the exact body, timestamp, and signature', () => {
  const rawBody = '{"hello":"world"}'; const headers = signed(rawBody);
  assert.equal(verifyEventSubSignature({ headers, rawBody, secret: 'eventsub-secret-for-tests', now: Date.parse('2026-10-28T12:00:01Z') }).valid, true);
  assert.equal(verifyEventSubSignature({ headers, rawBody: `${rawBody} `, secret: 'eventsub-secret-for-tests', now: Date.parse('2026-10-28T12:00:01Z') }).reason, 'signature-mismatch');
  assert.equal(verifyEventSubSignature({ headers, rawBody, secret: 'wrong-secret', now: Date.parse('2026-10-28T12:00:01Z') }).valid, false);
  assert.equal(verifyEventSubSignature({ headers, rawBody, secret: '', now: Date.parse('2026-10-28T12:00:01Z') }).reason, 'not-configured');
});

test('EventSub replay and stale deliveries fail closed', () => {
  const rawBody = '{}'; const headers = signed(rawBody, 'secret', new Date('2026-10-28T11:00:00Z'));
  assert.equal(verifyEventSubSignature({ headers, rawBody, secret: 'secret', now: Date.parse('2026-10-28T12:00:00Z') }).reason, 'stale-message');
  let now = 100; const guard = new EventSubReplayGuard({ ttlMs: 20, clock: () => now });
  assert.equal(guard.accept('delivery-1'), true);
  assert.equal(guard.accept('delivery-1'), false);
  now = 121;
  assert.equal(guard.accept('delivery-1'), true);
});

const payload = ({ badges = [{ set_id: 'moderator', id: '1' }], channel = 'channel-1', chatter = 'mod-1', text = '!context Why is Pluto called a dwarf planet?' } = {}) => ({
  subscription: { type: 'channel.chat.message', condition: { broadcaster_user_id: channel, user_id: channel } },
  event: { broadcaster_user_id: channel, chatter_user_id: chatter, badges, message: { text } },
});

test('chat parsing requires the configured channel, signed Twitch badge data, and explicit !context prefix', () => {
  const accepted = parseChatMessage(payload(), { broadcasterId: 'channel-1' });
  assert.equal(accepted.accepted, true); assert.equal(accepted.role, 'verified-moderator');
  assert.equal(accepted.text, 'Why is Pluto called a dwarf planet?');
  assert.equal(parseChatMessage(payload(), { broadcasterId: 'other-channel' }).reason, 'wrong-channel');
  const wrongReader = payload(); wrongReader.subscription.condition.user_id = 'other-user';
  assert.equal(parseChatMessage(wrongReader, { broadcasterId: 'channel-1' }).reason, 'wrong-reader');
  assert.equal(parseChatMessage(payload({ badges: [] }), { broadcasterId: 'channel-1' }).reason, 'role-unverified');
  assert.equal(parseChatMessage(payload({ text: 'Why is Pluto called a dwarf planet?' }), { broadcasterId: 'channel-1' }).reason, 'not-a-context-command');
  assert.equal(parseChatMessage({ event: { message: { text: '!context question' } } }, { broadcasterId: 'channel-1' }).accepted, false);
});

test('only Twitch-confirmed broadcaster badge for the configured account yields broadcaster role', () => {
  const result = parseChatMessage(payload({ badges: [{ set_id: 'broadcaster' }], chatter: 'channel-1' }), { broadcasterId: 'channel-1' });
  assert.equal(result.role, 'broadcaster');
  const fake = parseChatMessage(payload({ badges: [{ set_id: 'broadcaster' }], chatter: 'other-user' }), { broadcasterId: 'channel-1' });
  assert.equal(fake.accepted, false);
});
