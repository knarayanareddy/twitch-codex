import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorCookie, verifyOperatorCookie, createParticipantCookie, verifyParticipantCookie, hashActor, hashInvite, requireSameOrigin } from '../src/adapters/security.js';
import { decryptJson, encryptJson, loadEncryptionKey } from '../src/adapters/secret-vault.js';

test('operator cookie is signed, HttpOnly, SameSite lax for OAuth return, and expires', () => {
  const secret = 'quiet-quest-test-cookie-secret-with-length'; const cookie = createOperatorCookie(secret, 1_800_000_000_000, true);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/);
  const raw = cookie.match(/qq_operator=([^;]+)/)[1];
  assert.equal(verifyOperatorCookie(raw, secret, 1_800_000_000_001), true);
  assert.equal(verifyOperatorCookie(raw, secret, 1_800_100_000_000), false);
  const [payload, sig] = raw.split('.'); const changed = `${payload.slice(0, -1)}${payload.endsWith('a') ? 'b' : 'a'}.${sig}`;
  assert.equal(verifyOperatorCookie(changed, secret, 1_800_000_000_001), false);
});

test('companion participant cookie is session-bound, opaque, and independently hashed', () => {
  const secret = 'quiet-quest-test-cookie-secret-with-length'; const session = 'f'.repeat(8) + '-1111-4111-8111-' + 'f'.repeat(12);
  const first = createParticipantCookie(session, secret, 1_800_000_000_000, true);
  assert.match(first.cookie, /HttpOnly/); assert.match(first.cookie, /SameSite=Strict/); assert.match(first.cookie, /Secure/); assert.match(first.cookie, /Path=\/api\/companion/);
  const raw = first.cookie.match(/qq_participant=([^;]+)/)[1];
  assert.deepEqual(verifyParticipantCookie(raw, secret, 1_800_000_000_001), { sessionId: session, nonce: first.nonce, expiresAt: first.expiresAt });
  assert.equal(verifyParticipantCookie(raw, secret, first.expiresAt), null);
  assert.equal(hashActor(first.nonce, 'session-salt'), hashActor(first.nonce, 'session-salt'));
  assert.notEqual(hashActor(first.nonce, 'salt-one'), hashActor(first.nonce, 'salt-two'));
  assert.notEqual(hashInvite('invite-a', secret), hashInvite('invite-b', secret));
});

test('same-origin enforcement rejects missing, malformed, and cross-origin requests', () => {
  assert.doesNotThrow(() => requireSameOrigin({ headers: { origin: 'https://quiet.example', host: 'quiet.example' }, socket: { encrypted: true } }));
  assert.doesNotThrow(() => requireSameOrigin({ headers: { origin: 'https://quiet.example', host: 'internal:4180', 'x-forwarded-host': 'quiet.example', 'x-forwarded-proto': 'https' } }, { trustProxy: true }));
  assert.throws(() => requireSameOrigin({ headers: { host: 'quiet.example' } }), (error) => error.status === 403);
  assert.throws(() => requireSameOrigin({ headers: { origin: 'https://evil.example', host: 'quiet.example' }, socket: { encrypted: true } }), (error) => error.status === 403);
  assert.throws(() => requireSameOrigin({ headers: { origin: 'https://quiet.example', host: 'quiet.example' } }), (error) => error.status === 403);
});

test('AES-GCM token vault detects tampering and never serializes plaintext into the envelope', () => {
  const key = Buffer.alloc(32, 9); const credentials = { accessToken: 'access-secret', refreshToken: 'refresh-secret', scope: ['user:read:chat'] };
  const envelope = encryptJson(credentials, key); assert.doesNotMatch(envelope, /access-secret|refresh-secret/);
  assert.deepEqual(decryptJson(envelope, key), credentials);
  const [iv, tag, ciphertext] = envelope.split('.'); const tampered = `${iv}.${tag}.${ciphertext.slice(0, -2)}AA`;
  assert.throws(() => decryptJson(tampered, key));
  assert.throws(() => decryptJson(envelope, Buffer.alloc(32, 2)));
});

test('encryption key environment format is validated', () => {
  assert.equal(loadEncryptionKey({ envValue: 'ab'.repeat(32), filename: '/unused' }).length, 32);
  assert.throws(() => loadEncryptionKey({ envValue: 'weak', filename: '/unused' }), /64 hexadecimal/);
});
