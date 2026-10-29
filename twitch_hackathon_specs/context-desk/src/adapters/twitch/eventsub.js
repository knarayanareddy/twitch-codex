import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

function header(headers, name) {
  if (headers?.get) return headers.get(name);
  const key = Object.keys(headers ?? {}).find((item) => item.toLowerCase() === name);
  const value = key ? headers[key] : null;
  return Array.isArray(value) ? value[0] : value;
}

export function verifyEventSubSignature({ headers, rawBody, secret, now = Date.now() }) {
  if (!secret || typeof rawBody !== 'string') return { valid: false, reason: 'not-configured' };
  const messageId = header(headers, 'twitch-eventsub-message-id');
  const timestamp = header(headers, 'twitch-eventsub-message-timestamp');
  const supplied = header(headers, 'twitch-eventsub-message-signature');
  if (!messageId || !timestamp || !supplied || !/^sha256=[a-f0-9]{64}$/i.test(supplied)) return { valid: false, reason: 'missing-signature' };
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || Math.abs(now - time) > MAX_CLOCK_SKEW_MS) return { valid: false, reason: 'stale-message' };
  const expected = `sha256=${createHmac('sha256', secret).update(messageId + timestamp + rawBody, 'utf8').digest('hex')}`;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { valid: false, reason: 'signature-mismatch' };
  return { valid: true, messageId, timestamp };
}

export class EventSubReplayGuard {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 20_000, clock = () => Date.now() } = {}) {
    this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.clock = clock; this.seen = new Map();
  }
  accept(id) {
    const now = this.clock();
    for (const [key, expiry] of this.seen) if (expiry <= now) this.seen.delete(key);
    if (!id || this.seen.has(id)) return false;
    if (this.seen.size >= this.maxEntries) this.seen.delete(this.seen.keys().next().value);
    this.seen.set(id, now + this.ttlMs);
    return true;
  }
}

export function parseChatMessage(payload, { broadcasterId }) {
  const event = payload?.event;
  if (payload?.subscription?.type !== 'channel.chat.message' || !event) return { accepted: false, reason: 'unsupported-event' };
  if (!broadcasterId || event.broadcaster_user_id !== broadcasterId || payload?.subscription?.condition?.broadcaster_user_id !== broadcasterId) return { accepted: false, reason: 'wrong-channel' };
  if (payload.subscription.condition.user_id !== broadcasterId) return { accepted: false, reason: 'wrong-reader' };
  const badges = Array.isArray(event.badges) ? event.badges : [];
  const badgeNames = new Set(badges.filter((badge) => badge && typeof badge.set_id === 'string').map((badge) => badge.set_id));
  const broadcaster = event.chatter_user_id === broadcasterId && badgeNames.has('broadcaster');
  const moderator = badgeNames.has('moderator');
  if (!broadcaster && !moderator) return { accepted: false, reason: 'role-unverified' };
  const message = event.message?.text;
  if (typeof message !== 'string' || !message.trim()) return { accepted: false, reason: 'empty-message' };
  const command = message.match(/^!context\s+([\s\S]+)$/i);
  if (!command) return { accepted: false, reason: 'not-a-context-command' };
  return { accepted: true, text: command[1].trim(), role: broadcaster ? 'broadcaster' : 'verified-moderator', actorId: event.chatter_user_id };
}
