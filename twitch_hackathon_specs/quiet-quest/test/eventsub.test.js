import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventSubChatClient } from '../src/adapters/twitch/eventsub-client.js';

class FakeSocket extends EventEmitter { static instances = []; constructor(url) { super(); this.url = url; this.closed = false; FakeSocket.instances.push(this); } close() { this.closed = true; this.emit('close'); } }
const welcome = { metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'ws-session-1' } } };
function notification(text, { broadcaster = 'broadcaster-1', chatter = 'viewer-7', messageId = 'message-1' } = {}) { return { metadata: { message_type: 'notification' }, payload: { subscription: { type: 'channel.chat.message' }, event: { broadcaster_user_id: broadcaster, chatter_user_id: chatter, message_id: messageId, message: { text } } } }; }

test('EventSub WebSocket session subscribes only to channel chat with read-only scope model', async () => {
  FakeSocket.instances = []; const calls = []; const statuses = [];
  const client = new EventSubChatClient({ clientId: 'client-id', accessToken: 'user-access-token', broadcasterId: 'broadcaster-1', onCommand: () => {}, onStatus: (state) => statuses.push(state), WebSocketClass: FakeSocket, fetchImpl: async (url, options) => { calls.push({ url, options }); return { status: 202 }; } });
  client.start(); assert.equal(FakeSocket.instances[0].url, 'wss://eventsub.wss.twitch.tv/ws');
  await client.onMessage(JSON.stringify(welcome)); assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.type, 'channel.chat.message'); assert.deepEqual(payload.condition, { broadcaster_user_id: 'broadcaster-1', user_id: 'broadcaster-1' });
  assert.deepEqual(payload.transport, { method: 'websocket', session_id: 'ws-session-1' });
  assert.equal(calls[0].options.headers['Authorization'], 'Bearer user-access-token'); assert.ok(statuses.includes('connected')); client.stop();
});

test('only exact allowed commands for the configured channel become normalized actions', async () => {
  const commands = []; const client = new EventSubChatClient({ clientId: 'client-id', accessToken: 'token', broadcasterId: 'broadcaster-1', onCommand: (item) => commands.push(item), WebSocketClass: FakeSocket, fetchImpl: async () => ({ status: 202 }) });
  await client.onMessage(JSON.stringify(notification('!help 2')));
  await client.onMessage(JSON.stringify(notification('hello chat')));
  await client.onMessage(JSON.stringify(notification('!help 1 extra')));
  await client.onMessage(JSON.stringify(notification('!help 3', { broadcaster: 'other-channel' })));
  assert.deepEqual(commands, [{ broadcasterId: 'broadcaster-1', actorId: 'viewer-7', actionId: 'shade', deliveryId: 'message-1' }]);
  assert.equal(JSON.stringify(commands).includes('hello chat'), false); client.stop();
});

test('EventSub migration URL remains secure and inherits the existing subscription without duplicate creation', async () => {
  FakeSocket.instances = []; let subscriptions = 0; const client = new EventSubChatClient({ clientId: 'id', accessToken: 'token', broadcasterId: 'broadcaster-1', onCommand: () => {}, WebSocketClass: FakeSocket, fetchImpl: async () => { subscriptions++; return { status: 202 }; } });
  await client.onMessage(JSON.stringify(welcome)); assert.equal(subscriptions, 1);
  await client.onMessage(JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?keep=1' } } }));
  assert.equal(FakeSocket.instances.at(-1).url, 'wss://eventsub.wss.twitch.tv/ws?keep=1');
  await client.onMessage(JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'migrated' } } }));
  assert.equal(subscriptions, 1); assert.equal(client.migrating, false); client.stop();
});
