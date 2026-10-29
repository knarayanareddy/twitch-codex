import { EventSubChatClient } from '../adapters/twitch/eventsub-client.js';
import { decryptJson, encryptJson } from '../adapters/secret-vault.js';

const REQUIRED_SCOPE = 'user:read:chat';
export class TwitchManager {
  constructor({ store, service, clientId, clientSecret, redirectUri = '', encryptionKey, fetchImpl = fetch, EventSubClient = EventSubChatClient, clock = () => Date.now() }) {
    this.store = store; this.service = service; this.clientId = clientId; this.clientSecret = clientSecret; this.redirectUri = redirectUri; this.encryptionKey = encryptionKey; this.fetchImpl = fetchImpl; this.EventSubClient = EventSubClient; this.clock = clock;
    this.client = null; this.activeSessionId = null; this.status = 'disconnected'; this.credentials = null;
  }
  oauthReady() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }
  restore() {
    const saved = this.store.twitchCredential(); if (!saved) return;
    try { this.credentials = decryptJson(saved.encryptedJson, this.encryptionKey); this.user = { id: saved.userId, login: saved.login }; this.status = this.credentials.expiresAt > this.clock() ? 'authorized' : 'reauthorization-required'; }
    catch { this.store.deleteTwitchCredential(); this.status = 'reauthorization-required'; }
  }
  isAuthorized() { return Boolean(this.credentials?.accessToken && this.credentials.expiresAt > this.clock() && this.credentials.scopes?.includes(REQUIRED_SCOPE)); }
  publicStatus() { return { state: this.status, oauthReady: this.oauthReady(), broadcasterLogin: this.user?.login || null, note: this.status === 'connected' ? 'EventSub is receiving chat commands. Chat messages and names are not retained.' : this.status === 'authorized' ? 'Broadcaster authorized; EventSub connects when a Live session starts.' : this.status === 'reconnecting' ? 'Chat is reconnecting. Pause the round if you want contributions to wait.' : this.status === 'reauthorization-required' ? 'Twitch authorization needs attention before chat input can resume.' : this.oauthReady() ? 'Not connected to Twitch.' : 'Twitch OAuth is not configured.' }; }
  saveOAuth({ user, accessToken, refreshToken, expiresIn, scopes }) {
    if (!scopes.includes(REQUIRED_SCOPE)) throw new Error('Twitch authorization is missing user:read:chat.');
    this.user = { id: String(user.id), login: String(user.login) };
    this.credentials = { accessToken, refreshToken, expiresAt: this.clock() + Number(expiresIn) * 1000, scopes };
    this.persist(); this.status = 'authorized';
  }
  persist() {
    if (!this.credentials || !this.user) return;
    this.store.saveTwitchCredential({ encryptedJson: encryptJson(this.credentials, this.encryptionKey), userId: this.user.id, login: this.user.login, expiresAt: this.credentials.expiresAt, updatedAt: this.clock() });
  }
  async startForSession(sessionId) {
    if (!this.isAuthorized()) throw new Error('Authorize Twitch chat access before starting a Live session.');
    this.stopSocket(); this.activeSessionId = sessionId; this.status = 'reconnecting'; this.updateConnection('reconnecting');
    const client = new this.EventSubClient({
      clientId: this.clientId, accessToken: this.credentials.accessToken, broadcasterId: this.user.id,
      onCommand: ({ broadcasterId, actorId, actionId, deliveryId }) => {
        if (broadcasterId !== this.user.id || this.activeSessionId !== sessionId) return;
        this.service.contribute({ sessionId, round: this.service.get(sessionId)?.state.round, source: 'twitch', identity: actorId, actionId, deliveryId });
      },
      onStatus: (status) => { this.status = status; if (this.activeSessionId === sessionId) this.updateConnection(status); },
      fetchImpl: this.fetchImpl,
    });
    this.client = client; client.start();
  }
  updateConnection(connectionState) { try { this.service.control(this.activeSessionId, 'SET_CONNECTION', { connectionState }); } catch { /* session may already be closed */ } }
  stopSocket() { if (this.client) this.client.stop(); this.client = null; }
  stopSession(sessionId) { if (this.activeSessionId !== sessionId) return; this.stopSocket(); this.activeSessionId = null; if (this.credentials) this.status = 'authorized'; try { this.service.control(sessionId, 'SET_CONNECTION', { connectionState: 'disconnected' }); } catch { /* session may already be pruned */ } }
  async refreshIfNeeded() {
    if (!this.credentials || !this.credentials.refreshToken || this.credentials.expiresAt - this.clock() > 5 * 60 * 1000) return;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.credentials.refreshToken, client_id: this.clientId, client_secret: this.clientSecret });
    try {
      const response = await this.fetchImpl('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!response.ok) throw new Error('Twitch token refresh failed.');
      const data = await response.json();
      if (!data.access_token || !data.refresh_token || !data.scopes?.includes(REQUIRED_SCOPE)) throw new Error('Twitch token refresh response is incomplete.');
      const sessionId = this.activeSessionId;
      this.credentials = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.clock() + data.expires_in * 1000, scopes: data.scopes };
      this.persist();
      if (sessionId) await this.startForSession(sessionId);
    } catch {
      this.stopSocket(); this.credentials = null; this.store.deleteTwitchCredential(); this.status = 'reauthorization-required';
      if (this.activeSessionId) this.updateConnection('reauthorization-required');
    }
  }
  async disconnect() {
    const token = this.credentials?.accessToken; const sessionId = this.activeSessionId;
    this.stopSocket(); this.activeSessionId = null; this.credentials = null; this.user = null; this.store.deleteTwitchCredential(); this.status = 'disconnected';
    if (token && this.clientId) { try { const url = new URL('https://id.twitch.tv/oauth2/revoke'); url.searchParams.set('client_id', this.clientId); url.searchParams.set('token', token); await this.fetchImpl(url, { method: 'POST' }); } catch { /* local credential is deleted even if the revoke endpoint is unavailable */ } }
    if (sessionId) try { this.service.control(sessionId, 'SET_CONNECTION', { connectionState: 'disconnected' }); } catch {}
  }
  startRefreshLoop() { const timer = setInterval(() => { void this.refreshIfNeeded(); }, 60_000); timer.unref?.(); return timer; }
}
