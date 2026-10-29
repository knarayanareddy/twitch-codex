import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchManager } from '../src/application/twitch-manager.js';

class FakeEventSubClient { static created = []; constructor(options) { this.options = options; this.stopped = false; FakeEventSubClient.created.push(this); } start() {} stop() { this.stopped = true; } }
function fixture({ fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scopes: ['user:read:chat'] }) }) } = {}) {
  let now = 1_800_000_000_000; let saved = null; const changes = [];
  const store = { twitchCredential: () => saved, saveTwitchCredential: (value) => { saved = value; }, deleteTwitchCredential: () => { const had = Boolean(saved); saved = null; return had; } };
  const service = { control: (_id, _type, details) => { changes.push(details.connectionState); }, get: () => ({ state: { round: 1 } }), contribute: () => {} };
  const manager = new TwitchManager({ store, service, clientId: 'client', clientSecret: 'secret', encryptionKey: Buffer.alloc(32, 7), fetchImpl, EventSubClient: FakeEventSubClient, clock: () => now });
  return { manager, store, changes, advance(ms) { now += ms; }, saved: () => saved };
}

function authorize(manager) { manager.saveOAuth({ user: { id: 'broadcaster-id', login: 'quiet_host' }, accessToken: 'old-access', refreshToken: 'old-refresh', expiresIn: 1, scopes: ['user:read:chat'] }); }

test('refresh rotates encrypted credentials and restarts the active EventSub client', async () => {
  FakeEventSubClient.created = []; let request;
  const f = fixture({ fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scopes: ['user:read:chat'] }) }; } });
  authorize(f.manager); await f.manager.startForSession('session-1'); const prior = FakeEventSubClient.created[0];
  await f.manager.refreshIfNeeded();
  assert.equal(request.url, 'https://id.twitch.tv/oauth2/token'); assert.match(String(request.options.body), /refresh_token=old-refresh/);
  assert.equal(prior.stopped, true); assert.equal(FakeEventSubClient.created.length, 2); assert.equal(f.manager.status, 'reconnecting');
  assert.equal(f.manager.isAuthorized(), true); assert.ok(f.saved().encryptedJson); assert.doesNotMatch(f.saved().encryptedJson, /new-access|new-refresh/);
});

test('failed refresh removes unusable credentials and requires reauthorization for an active session', async () => {
  FakeEventSubClient.created = []; const f = fixture({ fetchImpl: async () => ({ ok: false }) });
  authorize(f.manager); await f.manager.startForSession('session-1'); const client = FakeEventSubClient.created[0];
  await f.manager.refreshIfNeeded();
  assert.equal(client.stopped, true); assert.equal(f.saved(), null); assert.equal(f.manager.status, 'reauthorization-required');
  assert.deepEqual(f.changes.slice(-1), ['reauthorization-required']);
});

test('Twitch authorization refuses tokens without the read-only chat scope', () => {
  const f = fixture();
  assert.throws(() => f.manager.saveOAuth({ user: { id: 'id', login: 'name' }, accessToken: 'token', refreshToken: 'refresh', expiresIn: 3600, scopes: [] }), /missing user:read:chat/);
  assert.equal(f.saved(), null);
});
