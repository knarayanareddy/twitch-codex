import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { TwitchOAuthManager, TwitchOAuthError, encryptTokens, decryptTokens, REQUIRED_TWITCH_SCOPES } from '../src/adapters/twitch/oauth-manager.js';

const KEY = 'a'.repeat(64);
const ENV = { TWITCH_CLIENT_ID: 'client-id', TWITCH_CLIENT_SECRET: 'server-only-secret', TWITCH_REDIRECT_URI: 'https://desk.example/auth/twitch/callback', TWITCH_EVENTSUB_CALLBACK_URL: 'https://desk.example/api/twitch/eventsub', TWITCH_EVENTSUB_SECRET: 'a-long-eventsub-secret', CONTEXT_DESK_ENCRYPTION_KEY: KEY };
const response = (data, status = 200) => new Response(data == null ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function makeManager({ env = ENV, responses = [], start = 1_798_200_000_000, fetchImpl } = {}) {
  let now = start; const store = new SqliteStore(':memory:'); const queue = [...responses];
  const manager = new TwitchOAuthManager({ store, sessionId: 'session-1', env, clock: () => now, fetchImpl: fetchImpl ?? (async () => { const next = queue.shift(); if (!next) throw new Error('unexpected fetch'); return next; }) });
  return { manager, store, queue, advance: (ms) => { now += ms; } };
}
const granted = [...REQUIRED_TWITCH_SCOPES];
const tokenResponse = { access_token: 'viewer-access-token', refresh_token: 'viewer-refresh-token', expires_in: 14400, scope: granted };
const userResponse = { data: [{ id: '123456', login: 'streamer' }] };
const appTokenResponse = { access_token: 'app-token', expires_in: 3600 };
const subscriptionResponse = { data: [{ id: 'sub-1', status: 'webhook_callback_verification_pending' }] };

function oauthResponses() { return [response(tokenResponse), response(userResponse), response(appTokenResponse), response(subscriptionResponse, 202)]; }
async function begin(manager) { const started = manager.begin('session-1'); return { ...started, parsed: new URL(started.url) }; }

 test('credential envelope uses authenticated AES-GCM encryption and detects tampering', () => {
  const clear = { accessToken: 'do-not-log', refreshToken: 'refresh', scopes: granted };
  const encrypted = encryptTokens(clear, KEY);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes(clear.accessToken), false);
  assert.deepEqual(decryptTokens(encrypted, KEY), clear);
  assert.throws(() => decryptTokens(`${encrypted.slice(0, -3)}bad`, KEY));
  assert.throws(() => encryptTokens(clear, 'not-an-encryption-key'), /32-byte key/);
});

test('OAuth start is HTTPS, requests only minimum scopes, and state is one-use and session-bound', async () => {
  const { manager, advance } = makeManager(); assert.equal(manager.ready, true);
  const first = await begin(manager);
  assert.equal(first.parsed.origin, 'https://id.twitch.tv');
  assert.equal(first.parsed.searchParams.get('scope'), 'user:read:chat user:bot');
  assert.equal(first.parsed.searchParams.get('force_verify'), 'true');
  assert.equal(manager.consumeState(first.state, 'other-session'), false);
  assert.equal(manager.consumeState(first.state, 'session-1'), true);
  assert.equal(manager.consumeState(first.state, 'session-1'), false);
  const second = await begin(manager); advance(10 * 60_000 + 1);
  assert.equal(manager.consumeState(second.state, 'session-1'), false);
});

test('OAuth completion verifies account, persists only encrypted server-side tokens, and subscribes signed webhook', async () => {
  const { manager, store } = makeManager({ responses: oauthResponses() });
  const { state } = await begin(manager);
  const completed = await manager.complete({ state, sessionId: 'session-1', code: 'authorization-code' });
  assert.deepEqual(completed, { broadcasterLogin: 'streamer', eventsubState: 'verification-pending' });
  const row = store.twitchConnection('session-1');
  assert.equal(row.broadcasterId, '123456'); assert.equal(row.eventsubId, 'sub-1');
  assert.equal(row.eventsubState, 'verification-pending'); assert.deepEqual(row.scopes, granted);
  assert.equal(JSON.stringify(row).includes('viewer-access-token'), false);
  assert.equal(manager.canAcceptMessages, false);
  assert.equal(manager.decryptConnection(row).refreshToken, 'viewer-refresh-token');
  manager.markWebhookVerified();
  assert.equal(manager.canAcceptMessages, true);
  assert.equal(manager.status.connected, true);
});

test('OAuth state is consumed on failed completion, and insufficient scopes fail closed', async () => {
  const { manager, store } = makeManager({ responses: [response({ ...tokenResponse, scope: ['user:read:chat'] })] });
  const { state } = await begin(manager);
  await assert.rejects(manager.complete({ state, sessionId: 'session-1', code: 'code' }), (error) => error instanceof TwitchOAuthError && error.code === 'TWITCH_SCOPE_MISSING');
  await assert.rejects(manager.complete({ state, sessionId: 'session-1', code: 'code' }), (error) => error.code === 'OAUTH_STATE_INVALID');
  assert.equal(store.twitchConnection('session-1'), null);
});

test('configured broadcaster identity mismatch cannot save credentials or subscribe', async () => {
  const { manager, store } = makeManager({ env: { ...ENV, TWITCH_BROADCASTER_ID: 'expected-id' }, responses: [response(tokenResponse), response(userResponse)] });
  const { state } = await begin(manager);
  await assert.rejects(manager.complete({ state, sessionId: 'session-1', code: 'code' }), (error) => error.code === 'TWITCH_ACCOUNT_MISMATCH');
  assert.equal(store.twitchConnection('session-1'), null);
});

test('expiring user token refresh is encrypted again; failed refresh removes trusted chat state', async () => {
  const { manager, store, advance, queue } = makeManager({ responses: oauthResponses() });
  const { state } = await begin(manager); await manager.complete({ state, sessionId: 'session-1', code: 'code' }); manager.markWebhookVerified();
  advance(14400_000 - 4 * 60_000);
  queue.push(response({ access_token: 'refreshed-access', refresh_token: 'rotated-refresh', expires_in: 14_400, scope: granted }));
  assert.equal(await manager.refreshIfNeeded(), true);
  assert.equal(manager.decryptConnection().accessToken, 'refreshed-access');
  assert.equal(manager.canAcceptMessages, true);
  advance(14_400_000);
  queue.push(response({ error: 'invalid_grant' }, 400));
  assert.equal(await manager.refreshIfNeeded(), false);
  assert.equal(manager.canAcceptMessages, false);
  assert.equal(store.twitchConnection('session-1').eventsubState, 'reauthorization-required');
});

test('incomplete or cross-origin OAuth callbacks never create a Twitch login URL', () => {
  const { manager } = makeManager({ env: {} });
  assert.equal(manager.ready, false);
  assert.throws(() => manager.begin('session-1'), (error) => error.code === 'TWITCH_NOT_CONFIGURED' && error.status === 503);
  const crossOrigin = makeManager({ env: { ...ENV, TWITCH_EVENTSUB_CALLBACK_URL: 'https://hooks.other.example/api/twitch/eventsub' } }).manager;
  assert.equal(crossOrigin.ready, false);
});
