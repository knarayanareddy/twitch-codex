import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export const REQUIRED_TWITCH_SCOPES = Object.freeze(['user:read:chat', 'user:bot']);
const HELIX = 'https://api.twitch.tv/helix';
const OAUTH = 'https://id.twitch.tv/oauth2';
const STATE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

function constantEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function keyBytes(key) {
  if (Buffer.isBuffer(key) && key.length === 32) return key;
  if (typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  throw new Error('Twitch credential encryption requires a 32-byte key (64 hex characters).');
}
export function encryptTokens(tokens, key) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
export function decryptTokens(encoded, key) {
  const [version, ivPart, tagPart, cipherPart] = String(encoded).split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !cipherPart) throw new Error('Encrypted Twitch credential record is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(cipherPart, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

export class TwitchOAuthError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'TwitchOAuthError'; this.code = code; this.status = status; }
}

export class TwitchOAuthManager {
  constructor({ store, sessionId, env = process.env, fetchImpl = globalThis.fetch, clock = () => Date.now() }) {
    this.store = store; this.sessionId = sessionId; this.fetch = fetchImpl; this.clock = clock; this.states = new Map(); this.appToken = null;
    this.refreshing = null;
    this.verifiedCallbacks = new Set();
    this.config = {
      clientId: env.TWITCH_CLIENT_ID || '', clientSecret: env.TWITCH_CLIENT_SECRET || '',
      redirectUri: env.TWITCH_REDIRECT_URI || '', callbackUrl: env.TWITCH_EVENTSUB_CALLBACK_URL || '',
      eventSubSecret: env.TWITCH_EVENTSUB_SECRET || '', encryptionKey: env.CONTEXT_DESK_ENCRYPTION_KEY || '',
      expectedBroadcasterId: env.TWITCH_BROADCASTER_ID || '',
    };
  }
  get ready() {
    let redirect; let callback;
    try { redirect = new URL(this.config.redirectUri); callback = new URL(this.config.callbackUrl); } catch { return false; }
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.eventSubSecret.length >= 10 && this.config.eventSubSecret.length <= 100
      && /^[a-f0-9]{64}$/i.test(this.config.encryptionKey) && redirect.protocol === 'https:' && redirect.pathname === '/auth/twitch/callback'
      && callback.protocol === 'https:' && callback.pathname === '/api/twitch/eventsub' && redirect.origin === callback.origin);
  }
  get status() {
    const row = this.store.twitchConnection(this.sessionId);
    if (!row) return { connected: false, state: this.ready ? 'ready-to-connect' : 'not-configured', broadcasterLogin: null, scopes: [], note: this.ready ? 'OAuth is ready. No Twitch account is connected.' : 'Twitch OAuth/EventSub settings are incomplete; moderator input is disabled.' };
    const configured = this.ready;
    const connected = configured && ['enabled', 'webhook-verified'].includes(row.eventsubState);
    return { connected, state: configured ? row.eventsubState : 'not-configured', broadcasterLogin: row.broadcasterLogin, scopes: row.scopes, connectedAt: row.connectedAt,
      note: !configured ? 'Twitch credentials, encryption, or HTTPS callbacks are missing. Chat input remains disabled.' : connected ? `Signed EventSub is active for ${row.broadcasterLogin}. This connection has not been live-accepted in this environment.` : 'Twitch authorization is saved, but EventSub has not been confirmed. Chat input remains disabled.' };
  }
  get broadcasterId() {
    const row = this.store.twitchConnection(this.sessionId);
    return row?.broadcasterId || this.config.expectedBroadcasterId || '';
  }
  get canAcceptMessages() { return this.ready && this.status.connected && this.broadcasterId.length > 0; }
  get storageKey() { try { return keyBytes(this.config.encryptionKey); } catch { return null; } }

  begin(sessionId) {
    if (!this.ready) throw new TwitchOAuthError('TWITCH_NOT_CONFIGURED', 'Twitch OAuth is not fully configured. Check client settings, HTTPS callback URLs, EventSub secret, and encryption key.', 503);
    const state = randomBytes(32).toString('hex');
    const now = this.clock();
    for (const [key, item] of this.states) if (item.expiresAt <= now) this.states.delete(key);
    this.states.set(state, { sessionId, expiresAt: now + STATE_TTL_MS });
    const authorize = new URL(`${OAUTH}/authorize`);
    authorize.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: REQUIRED_TWITCH_SCOPES.join(' '), state, force_verify: 'true' }).toString();
    return { state, url: authorize.toString() };
  }
  consumeState(state, sessionId) {
    const item = this.states.get(state);
    if (!item) return false;
    if (item.expiresAt <= this.clock()) { this.states.delete(state); return false; }
    if (item.sessionId !== sessionId) return false;
    this.states.delete(state); return true;
  }

  async requestJson(url, options, context) {
    let response;
    try { response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }); }
    catch { throw new TwitchOAuthError('TWITCH_UNAVAILABLE', `${context} could not reach Twitch. No chat input was enabled.`, 502); }
    const raw = await response.text(); let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* A malformed upstream response is treated as a failure below. */ }
    if (!response.ok) throw new TwitchOAuthError('TWITCH_UPSTREAM_ERROR', `${context} was rejected by Twitch (HTTP ${response.status}). No chat input was enabled.`, 502);
    return data;
  }

  async complete({ state, sessionId, code }) {
    if (!this.consumeState(state, sessionId)) throw new TwitchOAuthError('OAUTH_STATE_INVALID', 'Twitch authorization state expired or did not match this session.', 403);
    if (!code || typeof code !== 'string' || code.length > 2048) throw new TwitchOAuthError('OAUTH_CODE_INVALID', 'Twitch did not return a valid authorization code.', 400);
    const form = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: this.config.redirectUri });
    const tokenData = await this.requestJson(`${OAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }, 'Twitch token exchange');
    const accessToken = tokenData.access_token; const refreshToken = tokenData.refresh_token;
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !Array.isArray(tokenData.scope) || !REQUIRED_TWITCH_SCOPES.every((scope) => tokenData.scope.includes(scope))) {
      throw new TwitchOAuthError('TWITCH_SCOPE_MISSING', 'The Twitch account did not grant the minimum chat-reading scopes. No chat input was enabled.', 403);
    }
    const userData = await this.requestJson(`${HELIX}/users`, { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': this.config.clientId } }, 'Twitch account check');
    const account = userData.data?.[0];
    if (!account?.id || !account?.login || (this.config.expectedBroadcasterId && account.id !== this.config.expectedBroadcasterId)) {
      throw new TwitchOAuthError('TWITCH_ACCOUNT_MISMATCH', 'The connected Twitch account does not match the configured broadcaster.', 403);
    }
    const app = await this.getAppToken();
    const subscription = await this.requestJson(`${HELIX}/eventsub/subscriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Client-Id': this.config.clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: account.id, user_id: account.id }, transport: { method: 'webhook', callback: this.config.callbackUrl, secret: this.config.eventSubSecret } }),
    }, 'EventSub subscription creation');
    const created = subscription.data?.[0];
    if (!created?.id || !['webhook_callback_verification_pending', 'enabled'].includes(created.status)) {
      throw new TwitchOAuthError('EVENTSUB_SUBSCRIPTION_FAILED', 'Twitch did not confirm the chat subscription. No chat input was enabled.', 502);
    }
    const expiresAt = new Date(this.clock() + Math.max(60, Number(tokenData.expires_in) || 14_400) * 1000).toISOString();
    const encryptedTokens = encryptTokens({ accessToken, refreshToken, expiresAt, scopes: tokenData.scope }, this.config.encryptionKey);
    const eventsubState = created.status === 'enabled' || this.verifiedCallbacks.has(this.sessionId) ? 'enabled' : 'verification-pending';
    this.store.saveTwitchConnection({ sessionId: this.sessionId, broadcasterId: account.id, broadcasterLogin: account.login, encryptedTokens,
      scopes: tokenData.scope, connectedAt: new Date(this.clock()).toISOString(), tokenExpiresAt: expiresAt, eventsubId: created.id, eventsubState });
    return { broadcasterLogin: account.login, eventsubState };
  }

  async refreshIfNeeded() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const row = this.store.twitchConnection(this.sessionId);
      if (!row || !this.ready || Date.parse(row.tokenExpiresAt) > this.clock() + 5 * 60_000) return false;
      try {
        const tokens = this.decryptConnection(row);
        const form = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
        const data = await this.requestJson(`${OAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }, 'Twitch token refresh');
        if (typeof data.access_token !== 'string' || !Array.isArray(data.scope) || !REQUIRED_TWITCH_SCOPES.every((scope) => data.scope.includes(scope))) throw new Error('missing scope');
        const expiresAt = new Date(this.clock() + Math.max(60, Number(data.expires_in) || 14_400) * 1000).toISOString();
        this.store.saveTwitchConnection({ ...row, encryptedTokens: encryptTokens({ accessToken: data.access_token, refreshToken: data.refresh_token || tokens.refreshToken, expiresAt, scopes: data.scope }, this.config.encryptionKey), scopes: data.scope, tokenExpiresAt: expiresAt, eventsubState: row.eventsubState });
        return true;
      } catch {
        this.store.updateTwitchState(this.sessionId, 'reauthorization-required');
        return false;
      }
    })();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }
  startRefreshLoop() {
    const timer = setInterval(() => { this.refreshIfNeeded().catch(() => this.store.updateTwitchState(this.sessionId, 'reauthorization-required')); }, 60_000);
    timer.unref(); return timer;
  }

  async getAppToken() {
    if (this.appToken && this.appToken.expiresAt > this.clock() + 60_000) return this.appToken;
    const form = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'client_credentials' });
    const data = await this.requestJson(`${OAUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }, 'Twitch app token request');
    if (typeof data.access_token !== 'string') throw new TwitchOAuthError('TWITCH_APP_TOKEN_FAILED', 'Twitch app authorization failed. No chat input was enabled.', 502);
    this.appToken = { token: data.access_token, expiresAt: this.clock() + (Number(data.expires_in) || 3600) * 1000 };
    return this.appToken;
  }
  markWebhookVerified() { this.verifiedCallbacks.add(this.sessionId); if (this.store.twitchConnection(this.sessionId)) this.store.updateTwitchState(this.sessionId, 'enabled'); }
  markRevoked() { if (this.store.twitchConnection(this.sessionId)) this.store.updateTwitchState(this.sessionId, 'revoked'); }
  async disconnect() {
    const row = this.store.twitchConnection(this.sessionId);
    if (!row) return false;
    this.store.deleteTwitchConnection(this.sessionId);
    this.verifiedCallbacks.delete(this.sessionId);
    try {
      const tokens = this.decryptConnection(row);
      await this.requestJson(`${OAUTH}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.clientId, token: tokens.accessToken }) }, 'Twitch token revocation');
    } catch { /* Local disable remains authoritative if remote revocation is unavailable. */ }
    try {
      const app = await this.getAppToken();
      if (row.eventsubId) await this.fetch(`${HELIX}/eventsub/subscriptions?id=${encodeURIComponent(row.eventsubId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${app.token}`, 'Client-Id': this.config.clientId }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch { /* The local record is removed below, so no further chat is accepted. */ }
    return true;
  }
  decryptConnection(row = this.store.twitchConnection(this.sessionId)) {
    if (!row) return null;
    return decryptTokens(row.encryptedTokens, this.config.encryptionKey);
  }
}
