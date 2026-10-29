import WebSocket from 'ws';
import { ACTION_BY_COMMAND } from '../../domain/game.js';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
export class EventSubChatClient {
  constructor({ clientId, accessToken, broadcasterId, onCommand, onStatus = () => {}, WebSocketClass = WebSocket, fetchImpl = fetch, reconnectDelay = (attempt) => Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000) }) {
    this.clientId = clientId; this.accessToken = accessToken; this.broadcasterId = broadcasterId; this.onCommand = onCommand; this.onStatus = onStatus;
    this.WebSocketClass = WebSocketClass; this.fetchImpl = fetchImpl; this.reconnectDelay = reconnectDelay;
    this.stopped = false; this.socket = null; this.timer = null; this.attempt = 0; this.subscribed = false; this.migrating = false;
  }
  start(url = EVENTSUB_URL, migrating = false) {
    this.stopped = false; this.migrating = migrating; this.connect(url);
  }
  connect(url, migrating = false) {
    if (this.stopped) return;
    this.migrating = migrating;
    let target; try { target = new URL(url); } catch { return this.fail('invalid-eventsub-url'); }
    if (target.protocol !== 'wss:') return this.fail('insecure-eventsub-url');
    this.onStatus('reconnecting');
    const socket = new this.WebSocketClass(target.href); this.socket = socket;
    socket.on('message', (data) => { void this.onMessage(data); });
    socket.on('error', () => {});
    socket.on('close', () => { if (this.socket === socket) { this.socket = null; this.scheduleReconnect(); } });
    socket.on('open', () => { this.attempt = 0; });
  }
  async onMessage(raw) {
    let message; try { message = JSON.parse(String(raw)); } catch { return; }
    const metadata = message.metadata || {}; const payload = message.payload || {};
    if (metadata.message_type === 'session_welcome') {
      const id = payload.session?.id; if (!id) return this.fail('missing-websocket-session');
      this.onStatus('connected'); this.attempt = 0;
      if (!this.migrating) {
        try { await this.subscribe(id); this.subscribed = true; this.onStatus('connected'); }
        catch { this.onStatus('reconnecting'); try { this.socket?.close(); } catch {} }
      }
      this.migrating = false; return;
    }
    if (metadata.message_type === 'session_reconnect') {
      const reconnectUrl = payload.session?.reconnect_url;
      if (typeof reconnectUrl === 'string') { this.onStatus('reconnecting'); this.connect(reconnectUrl, true); }
      return;
    }
    if (metadata.message_type === 'revocation') {
      this.onStatus('reauthorization-required'); return;
    }
    if (metadata.message_type !== 'notification' || payload.subscription?.type !== 'channel.chat.message') return;
    const event = payload.event || {};
    if (event.broadcaster_user_id !== this.broadcasterId || typeof event.chatter_user_id !== 'string' || typeof event.message_id !== 'string') return;
    if (typeof event.message?.text !== 'string') return;
    const command = ACTION_BY_COMMAND.get(event.message.text.trim().toLocaleLowerCase('en'));
    if (!command) return;
    try { await this.onCommand({ broadcasterId: event.broadcaster_user_id, actorId: event.chatter_user_id, actionId: command.id, deliveryId: event.message_id }); } catch { /* inbound chat never produces a public chat reply */ }
  }
  async subscribe(websocketSessionId) {
    const response = await this.fetchImpl('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Client-Id': this.clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.broadcasterId, user_id: this.broadcasterId }, transport: { method: 'websocket', session_id: websocketSessionId } }),
    });
    if (response.status !== 202) throw new Error(`EventSub subscription failed (${response.status}).`);
  }
  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.onStatus('reconnecting'); const delay = this.reconnectDelay(this.attempt++);
    this.timer = setTimeout(() => { this.timer = null; this.connect(EVENTSUB_URL, false); }, delay); this.timer.unref?.();
  }
  fail(reason) { this.onStatus('reauthorization-required', reason); this.stop(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; const socket = this.socket; this.socket = null; try { socket?.close(); } catch {} }
}
