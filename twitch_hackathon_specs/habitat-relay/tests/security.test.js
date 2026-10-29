import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, hashActor, makeOAuthState, parseEncryptionKey, parseVoteCommand, safeEqual, SlidingWindowLimiter } from '../src/adapters/security.js';

test('accepts exactly 32-byte hex or base64 encryption keys', () => {
  const raw = randomBytes(32);
  assert.equal(parseEncryptionKey(raw.toString('hex')).length, 32);
  assert.equal(parseEncryptionKey(raw.toString('base64')).length, 32);
  assert.equal(parseEncryptionKey('short'), null);
  assert.equal(parseEncryptionKey(''), null);
  assert.equal(parseEncryptionKey(null), null);
});

test('AES-GCM secret roundtrip', () => {
  const key = randomBytes(32);
  const record = encryptSecret('token value', key);
  assert.equal(decryptSecret(record, key), 'token value');
  assert.notEqual(record.ciphertext, 'token value');
});

test('AES-GCM uses fresh nonce by default', () => {
  const key = randomBytes(32);
  const a = encryptSecret('same', key);
  const b = encryptSecret('same', key);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('AES-GCM rejects wrong key and tampered ciphertext/tag', () => {
  const key = randomBytes(32);
  const record = encryptSecret('secret', key);
  assert.throws(() => decryptSecret(record, randomBytes(32)));
  assert.throws(() => decryptSecret({ ...record, ciphertext: Buffer.from('tampered').toString('base64') }, key));
  assert.throws(() => decryptSecret({ ...record, authTag: Buffer.alloc(16).toString('base64') }, key));
});

test('encryption rejects wrong key length and malformed inputs', () => {
  assert.throws(() => encryptSecret('a', Buffer.alloc(8)), /32 bytes/);
  assert.throws(() => decryptSecret(null, Buffer.alloc(32)));
});

test('actor hash is deterministic for same session key but scoped by salt', () => {
  const first = hashActor('twitch-id-123', 'session-1');
  assert.equal(hashActor('twitch-id-123', 'session-1'), first);
  assert.notEqual(hashActor('twitch-id-123', 'session-2'), first);
  assert.equal(first.includes('twitch-id'), false);
});

test('OAuth state is high entropy URL-safe text', () => {
  const first = makeOAuthState();
  const second = makeOAuthState();
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(first, second);
});

test('safeEqual handles equality, inequality, and non-string values', () => {
  assert.equal(safeEqual('abc','abc'), true);
  assert.equal(safeEqual('abc','abd'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual(undefined,'x'), false);
  assert.equal(safeEqual('x',null), false);
});

test('vote parser accepts exact numbered commands and normalizes whitespace', () => {
  assert.equal(parseVoteCommand('!habitat 1'), 0);
  assert.equal(parseVoteCommand('  !HABITAT   2  '), 1);
});

test('vote parser rejects arbitrary text, option injection, suffixes, and overlong input', () => {
  for (const text of ['hello','!habitat 3','!habitat 1 extra','!habitat 1;ban','!habitat -1','!habitat 01','x'.repeat(301),null,42]) assert.equal(parseVoteCommand(text), null);
});

test('sliding window limiter accepts limit then blocks and resets after window', () => {
  let now = 100;
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('a'), false);
  now = 1100;
  assert.equal(limiter.allow('a'), true);
});

test('sliding window limiter isolates keys and prunes expired entries', () => {
  let now = 0;
  const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 50, now: () => now });
  assert.equal(limiter.allow('a'), true);
  assert.equal(limiter.allow('b'), true);
  now = 60;
  assert.equal(limiter.allow('c'), true);
  assert.equal(limiter.entries.has('a'), false);
});
