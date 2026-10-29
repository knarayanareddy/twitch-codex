import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { decryptSecret, encryptSecret } from './security.js';

const TWITCH_AUTHORIZE = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_USERS = 'https://api.twitch.tv/helix/users';
const TWITCH_SUBSCRIPTIONS = 'https://api.twitch.tv/helix/eventsub/subscriptions';
const EVENTSUB_SOCKET = 'wss://eventsub.wss.twitch.tv/ws';
const REQUIRED_SCOPE = 'user:read:chat';

export class TwitchError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'TwitchError'; this.code = code; this.status = status; }
}

export function createAuthorizationUrl({ clientId, redirectUri, state, scopes = [REQUIRED_SCOPE] }) {
  const url = new URL(TWITCH_AUTHORIZE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

export class TwitchAdapter extends EventEmitter {
  constructor({ clientId, clientSecret, redirectUri, store, encryptionKey, onChat = () => {}, fetchImpl = fetch, WebSocketImpl = WebSocket, now = () => Date.now(), reconnectBaseMs = 1200, maxReconnectMs = 30_000 }) {
    super();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.store = store;
    this.encryptionKey = encryptionKey;
    this.onChat = onChat;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.reconnectBaseMs = reconnectBaseMs;
    this.maxReconnectMs = maxReconnectMs;
    this.socket = null;
    this.profile = null;
    this.tokens = null;
    this.ready = false;
    this.error = null;
    this.closedByUser = false;
    this.migrating = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.generation = 0;
    this.lastDeliveryAt = null;
    this.loadStoredTokens();
  }

  isConfigured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.encryptionKey?.length === 32); }

  status() {
    return {
      configured: this.isConfigured(),
      connected: Boolean(this.profile),
      ready: this.ready,
      profile: this.profile ? { id: this.profile.id, login: this.profile.login, displayName: this.profile.displayName } : null,
      error: this.error,
      lastDeliveryAt: this.lastDeliveryAt,
      transport: this.ready ? 'EventSub connected' : this.profile ? 'Connecting' : 'Not connected',
    };
  }

  loadStoredTokens() {
    if (!this.encryptionKey) return;
    const encrypted = this.store.getEncryptedSecret('twitch_tokens');
    if (!encrypted) return;
    try {
      this.tokens = JSON.parse(decryptSecret(encrypted, this.encryptionKey));
      this.profile = this.tokens.profile ?? null;
    } catch {
      this.error = 'Saved Twitch credentials could not be decrypted. Check HABITAT_ENCRYPTION_KEY; no token was exposed.';
      this.tokens = null;
      this.profile = null;
    }
  }

  authorizeUrl(state) {
    if (!this.isConfigured()) throw new TwitchError('NOT_CONFIGURED', 'Add Twitch app credentials and an encryption key before connecting.', 503);
    return createAuthorizationUrl({ clientId: this.clientId, redirectUri: this.redirectUri, state });
  }

  async finishAuthorization({ code, stateMatches }) {
    if (!this.isConfigured()) throw new TwitchError('NOT_CONFIGURED', 'Twitch OAuth is not configured.', 503);
    if (!stateMatches) throw new TwitchError('INVALID_STATE', 'Twitch sign-in could not be verified. Start the connection again.', 400);
    if (typeof code !== 'string' || code.length < 1 || code.length > 2048) throw new TwitchError('INVALID_CODE', 'Twitch did not return a valid authorization code.');
    const tokenData = await this.exchangeCode(code);
    const validated = await this.validateToken(tokenData.access_token);
    if (!Array.isArray(validated.scopes) || !validated.scopes.includes(REQUIRED_SCOPE)) {
      throw new TwitchError('MISSING_SCOPE', `The Twitch account must grant ${REQUIRED_SCOPE}. Disconnect and authorize again with the required permission.`, 403);
    }
    const userResponse = await this.fetchImpl(TWITCH_USERS, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Client-Id': this.clientId },
    });
    if (!userResponse.ok) throw new TwitchError('USER_LOOKUP_FAILED', 'Twitch authorization succeeded, but the account lookup failed.', 502);
    const users = await userResponse.json();
    const user = users.data?.[0];
    if (!user?.id || !user?.login) throw new TwitchError('USER_LOOKUP_FAILED', 'Twitch did not return a usable broadcaster profile.', 502);
    this.tokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: this.now() + Number(tokenData.expires_in ?? 0) * 1000,
      profile: { id: user.id, login: user.login, displayName: user.display_name ?? user.login },
    };
    this.profile = this.tokens.profile;
    this.error = null;
    this.persistTokens();
    this.connect(EVENTSUB_SOCKET, { subscribeOnWelcome: true });
    return this.profile;
  }

  async exchangeCode(code) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    });
    const response = await this.fetchImpl(TWITCH_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new TwitchError('TOKEN_EXCHANGE_FAILED', 'Could not exchange the Twitch sign-in code. Check the app client and redirect URI.', 502);
    return data;
  }

  async validateToken(accessToken = this.tokens?.accessToken) {
    if (!accessToken) throw new TwitchError('NO_TOKEN', 'No Twitch access token is available.', 401);
    const response = await this.fetchImpl(TWITCH_VALIDATE, { headers: { Authorization: `OAuth ${accessToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TwitchError('TOKEN_INVALID', 'Twitch access token is invalid or expired.', 401);
    return data;
  }

  async refreshAccessToken() {
    if (!this.tokens?.refreshToken) throw new TwitchError('NO_REFRESH_TOKEN', 'Reconnect your Twitch account to continue.', 401);
    const params = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken });
    const response = await this.fetchImpl(TWITCH_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new TwitchError('REFRESH_FAILED', 'Twitch could not refresh the connection. Reconnect the account.', 401);
    this.tokens.accessToken = data.access_token;
    this.tokens.refreshToken = data.refresh_token ?? this.tokens.refreshToken;
    this.tokens.expiresAt = this.now() + Number(data.expires_in ?? 0) * 1000;
    this.persistTokens();
    return this.tokens.accessToken;
  }

  persistTokens() {
    if (!this.encryptionKey || !this.tokens) return;
    this.store.setEncryptedSecret('twitch_tokens', encryptSecret(JSON.stringify(this.tokens), this.encryptionKey), this.now());
  }

  async accessToken() {
    if (!this.tokens?.accessToken) throw new TwitchError('NO_TOKEN', 'Connect a Twitch account first.', 401);
    if (this.tokens.expiresAt - this.now() < 60_000) return this.refreshAccessToken();
    try { await this.validateToken(this.tokens.accessToken); return this.tokens.accessToken; }
    catch { return this.refreshAccessToken(); }
  }

  connect(url = EVENTSUB_SOCKET, { subscribeOnWelcome = true, migration = false } = {}) {
    if (!this.profile || this.closedByUser) return;
    this.clearReconnect();
    const generation = ++this.generation;
    this.ready = false;
    this.migrating = migration;
    this.emitStatus();
    const socket = new this.WebSocketImpl(url);
    this.socket = socket;
    socket.on('open', () => { if (generation === this.generation) this.error = null; });
    socket.on('message', (raw) => {
      if (generation !== this.generation) return;
      this.handleFrame(raw, { subscribeOnWelcome, generation }).catch((error) => {
        this.error = error.message;
        this.emitStatus();
      });
    });
    socket.on('error', () => {
      if (generation === this.generation) { this.ready = false; this.error = 'Twitch EventSub connection error.'; this.emitStatus(); }
    });
    socket.on('close', () => {
      if (generation !== this.generation) return;
      this.ready = false;
      this.emitStatus();
      if (!this.closedByUser && !this.migrating) this.scheduleReconnect();
    });
  }

  async handleFrame(raw, { subscribeOnWelcome = true, generation = this.generation } = {}) {
    let frame;
    try { frame = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
    catch { this.error = 'Twitch sent an unreadable EventSub frame.'; this.emitStatus(); return; }
    const type = frame.metadata?.message_type;
    if (type === 'session_welcome') {
      this.ready = true;
      this.reconnectAttempt = 0;
      this.error = null;
      this.emitStatus();
      if (subscribeOnWelcome && !this.migrating) await this.createChatSubscription(frame.payload?.session?.id);
      this.migrating = false;
      return;
    }
    if (type === 'session_keepalive') { this.ready = true; this.lastDeliveryAt = this.lastDeliveryAt ?? this.now(); return; }
    if (type === 'session_reconnect') {
      const reconnectUrl = frame.payload?.session?.reconnect_url;
      if (typeof reconnectUrl === 'string' && reconnectUrl.startsWith('wss://')) {
        this.migrating = true;
        try { this.socket?.close(); } catch { /* close is best-effort */ }
        this.connect(reconnectUrl, { subscribeOnWelcome: false, migration: true });
      }
      return;
    }
    if (type === 'revocation') {
      this.ready = false;
      this.error = 'Twitch revoked the chat subscription. Reconnect the account to continue.';
      this.emitStatus();
      return;
    }
    if (type === 'notification' && frame.metadata?.subscription_type === 'channel.chat.message') {
      const event = frame.payload?.event;
      if (event?.broadcaster_user_id !== this.profile?.id || event?.user_id && event.user_id !== this.profile?.id) {
        return;
      }
      this.lastDeliveryAt = this.now();
      this.onChat({
        text: event.message?.text,
        actorId: event.chatter_user_id,
        chatterLogin: event.chatter_user_login,
        deliveryId: frame.metadata?.message_id,
        receivedAt: this.now(),
      });
      this.emitStatus();
    }
  }

  async createChatSubscription(sessionId) {
    if (!sessionId || !this.profile) throw new TwitchError('MISSING_SESSION', 'Twitch EventSub session is not ready.');
    const token = await this.accessToken();
    const response = await this.fetchImpl(TWITCH_SUBSCRIPTIONS, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: this.profile.id, user_id: this.profile.id },
        transport: { method: 'websocket', session_id: sessionId },
      }),
    });
    if (response.status !== 202) {
      const body = await response.json().catch(() => ({}));
      this.ready = false;
      this.error = `Could not subscribe to Twitch chat (${response.status}). Check authorization and channel setup.`;
      this.emitStatus();
      throw new TwitchError('SUBSCRIPTION_FAILED', body.message ?? this.error, 502);
    }
    this.ready = true;
    this.emitStatus();
  }

  scheduleReconnect() {
    this.clearReconnect();
    this.reconnectAttempt += 1;
    const base = Math.min(this.maxReconnectMs, this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt - 1, 5)));
    const jitter = Math.floor(Math.random() * Math.min(500, base / 4));
    this.reconnectTimer = setTimeout(() => {
      if (this.profile && !this.closedByUser) this.connect(EVENTSUB_SOCKET, { subscribeOnWelcome: true });
    }, base + jitter);
    this.reconnectTimer.unref?.();
    this.error = `Reconnecting to Twitch (attempt ${this.reconnectAttempt}).`;
    this.emitStatus();
  }

  clearReconnect() { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  emitStatus() { this.emit('status', this.status()); }

  disconnect() {
    this.closedByUser = true;
    this.ready = false;
    this.clearReconnect();
    this.generation += 1;
    try { this.socket?.close(); } catch { /* best-effort */ }
    this.socket = null;
    this.profile = null;
    this.tokens = null;
    this.store.deleteSecret('twitch_tokens');
    this.error = null;
    this.emitStatus();
  }

  shutdown() {
    this.closedByUser = true;
    this.clearReconnect();
    this.generation += 1;
    try { this.socket?.close(); } catch { /* best-effort */ }
  }
}
