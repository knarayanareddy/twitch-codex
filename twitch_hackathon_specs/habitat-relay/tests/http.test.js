import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { createApp } from '../src/server.js';
import { Store } from '../src/adapters/store.js';
import { HabitatService } from '../src/application/habitat-service.js';

async function fixture(options={}) {
  const store = new Store(':memory:');
  const app = createApp({ store, env: {}, now: options.now ?? (()=>1000), roundDurationMs: options.roundDurationMs ?? 20_000, logger:{error:()=>{}}, ...options });
  await new Promise((resolve,reject)=>app.server.listen(0,'127.0.0.1',resolve).once('error',reject));
  const address=app.server.address();
  const base=`http://127.0.0.1:${address.port}`;
  const request=(path,options={})=>fetch(`${base}${path}`,{...options,headers:{...(options.method==='POST'?{Origin:base}:{}),...(options.headers??{})}});
  return { app,store,base,request,close:async()=>{await app.close();store.close();} };
}
const post=(body)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('health endpoint reports ready server without sensitive config', async()=>{
  const f=await fixture();
  const response=await f.request('/api/health');
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.database,'ready');
  assert.equal(JSON.stringify(body).includes('secret'),false);
  await f.close();
});

test('public state and content endpoints return schema, scenario, and source links', async()=>{
  const f=await fixture();
  const state=await (await f.request('/api/state')).json();
  const content=await (await f.request('/api/content')).json();
  assert.equal(state.phase,'ready');
  assert.equal(state.totalRounds,3);
  assert.equal(content.rounds.length,3);
  assert.ok(content.sources.some((s)=>s.publisher==='European Environment Agency'));
  assert.ok(content.sources.every((s)=>s.url.startsWith('https://')));
  await f.close();
});

test('static application includes security headers and serves local assets', async()=>{
  const f=await fixture();
  const response=await f.request('/');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(await response.text(),/Habitat Relay/);
  assert.equal((await f.request('/js/app.js')).status,200);
  assert.match((await f.request('/js/app.js')).headers.get('content-type'),/javascript/);
  await f.close();
});

test('server rejects missing or foreign Origin on state-changing API calls', async()=>{
  const f=await fixture();
  const missing=await fetch(`${f.base}/api/command`,post({command:'start'}));
  assert.equal(missing.status,403);
  const foreign=await fetch(`${f.base}/api/command`,{...post({command:'start'}),headers:{Origin:'https://attacker.example','Content-Type':'application/json'}});
  assert.equal(foreign.status,403);
  assert.equal((await (await f.request('/api/state')).json()).phase,'ready');
  await f.close();
});

test('start demo, cast a vote, close, approve, and see state over HTTP', async()=>{
  const f=await fixture();
  let response=await f.request('/api/command',post({command:'start',payload:{mode:'demo'}}));
  assert.equal(response.status,200);
  let result=await response.json();
  assert.equal(result.state.phase,'voting');
  const option=result.state.round.options[0].id;
  response=await f.request('/api/vote',post({optionId:option,actor:'viewer-one'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).state.voteTotal,1);
  response=await f.request('/api/command',post({command:'close-round'}));
  assert.equal((await response.json()).state.phase,'review');
  response=await f.request('/api/command',post({command:'approve-choice'}));
  result=await response.json();
  assert.equal(result.state.phase,'voting');
  assert.equal(result.state.roundIndex,1);
  assert.equal(result.state.history.length,1);
  await f.close();
});

test('demo vote endpoint rejects live mode and duplicate actor votes', async()=>{
  const f=await fixture();
  const denied=await f.request('/api/command',post({command:'start',payload:{mode:'live',confirmChannelId:'no-channel'}}));
  assert.equal(denied.status,409);
  f.app.service.execute('reset',{mode:'live'});
  f.app.service.execute('start',{mode:'live'});
  const live=await f.request('/api/vote',post({optionId:'wildflower-strip',actor:'x'}));
  assert.equal(live.status,403);
  await f.request('/api/command',post({command:'reset',payload:{mode:'demo'}}));
  await f.request('/api/command',post({command:'start',payload:{mode:'demo'}}));
  const first=await f.request('/api/vote',post({optionId:'wildflower-strip',actor:'same-user'}));
  const second=await f.request('/api/vote',post({optionId:'lighter-mowing',actor:'same-user'}));
  assert.equal(first.status,200);
  assert.equal(second.status,409);
  await f.close();
});

test('command errors are returned as safe structured JSON', async()=>{
  const f=await fixture();
  const response=await f.request('/api/command',post({command:'warp'}));
  const body=await response.json();
  assert.equal(response.status,404);
  assert.equal(body.error,'UNKNOWN_COMMAND');
  assert.ok(body.message);
  assert.equal(JSON.stringify(body).includes('stack'),false);
  await f.close();
});

test('malformed JSON, oversized bodies, and unknown routes fail safely', async()=>{
  const f=await fixture();
  const malformed=await f.request('/api/command',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
  const huge=await f.request('/api/command',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({x:'a'.repeat(40_000)})});
  assert.equal(huge.status,413);
  const missing=await f.request('/api/nope');
  assert.equal(missing.status,404);
  const method=await f.request('/api/state',{method:'DELETE'});
  assert.equal(method.status,405);
  await f.close();
});

test('recap endpoint is a download and omits actor identities', async()=>{
  const f=await fixture();
  await f.request('/api/command',post({command:'start'}));
  await f.request('/api/vote',post({optionId:'wildflower-strip',actor:'private-viewer'}));
  await f.request('/api/command',post({command:'close-round'}));
  await f.request('/api/command',post({command:'approve-choice'}));
  const response=await f.request('/api/recap');
  assert.match(response.headers.get('content-disposition'),/attachment/);
  const body=await response.text();
  assert.match(body,/not ecological measurements/);
  assert.equal(body.includes('private-viewer'),false);
  await f.close();
});

test('SSE stream starts with state and cleans up when client disconnects', async()=>{
  const f=await fixture();
  const controller=new AbortController();
  const response=await f.request('/api/stream',{signal:controller.signal});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader();
  const first=await reader.read();
  assert.match(new TextDecoder().decode(first.value),/event: state/);
  controller.abort();
  await reader.cancel().catch(()=>{});
  await f.close();
});

test('Twitch status is safe when integration is unconfigured', async()=>{
  const f=await fixture();
  const body=await (await f.request('/api/twitch/status')).json();
  assert.equal(body.configured,false);
  assert.equal(body.connected,false);
  assert.equal(JSON.stringify(body).includes('client-secret'),false);
  await f.close();
});

test('OAuth entry point gives a clear setup response when Twitch app secrets are absent', async()=>{
  const f=await fixture();
  const response=await f.request('/auth/twitch',{redirect:'manual'});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/credentials/);
  await f.close();
});

test('session-scoped OBS link is unguessable, read-only, and revoked on reset', async () => {
  const f = await fixture();
  const linkData = await (await f.request('/api/operator/overlay-link')).json();
  const url = new URL(linkData.url);
  const key = url.searchParams.get('key');
  assert.ok(key && key.length >= 40);
  const authorized = await f.request(`/?view=overlay&key=${encodeURIComponent(key)}`);
  assert.equal(authorized.status, 200);
  assert.equal((await f.request('/?view=overlay')).status, 403);
  assert.equal((await f.request(`/api/state?overlayKey=${encodeURIComponent(key)}`)).status, 200);
  assert.equal((await f.request('/api/state?overlayKey=wrong-key')).status, 403);
  const mutation = await f.request('/api/command', post({ command: 'start', payload: { mode: 'demo' } }));
  assert.equal(mutation.status, 200);
  const reset = await f.request('/api/command', post({ command: 'reset', payload: { mode: 'demo' } }));
  assert.equal(reset.status, 200);
  const newKey = new URL((await (await f.request('/api/operator/overlay-link')).json()).url).searchParams.get('key');
  assert.notEqual(newKey, key);
  assert.equal((await f.request(`/?view=overlay&key=${encodeURIComponent(key)}`)).status, 403);
  assert.equal((await f.request(`/?view=overlay&key=${encodeURIComponent(newKey)}`)).status, 200);
  await f.close();
});

test('overlay SSE requires its session key, omits Twitch operator state, and revokes on session reset', async () => {
  const f = await fixture();
  const key = new URL((await (await f.request('/api/operator/overlay-link')).json()).url).searchParams.get('key');
  assert.equal((await f.request('/api/stream?overlayKey=invalid')).status, 403);
  const response = await f.request(`/api/stream?overlayKey=${encodeURIComponent(key)}`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /event: state/);
  assert.doesNotMatch(initial, /event: twitch/);
  await f.request('/api/command', post({ command: 'reset', payload: { mode: 'demo' } }));
  const revoked = new TextDecoder().decode((await reader.read()).value);
  assert.match(revoked, /overlay-revoked/);
  await reader.cancel();
  await f.close();
});

test('completion exposes optional action redirect and Markdown recap without identity', async () => {
  const f = await fixture();
  await f.request('/api/command', post({ command: 'start', payload: { mode: 'demo' } }));
  for (let index = 0; index < 3; index += 1) {
    let state = (await (await f.request('/api/state')).json());
    await f.request('/api/command', post({ command: 'close-round' }));
    await f.request('/api/command', post({ command: 'select-choice', payload: { choiceId: state.round.options[index === 2 ? 1 : 0].id } }));
    await f.request('/api/command', post({ command: 'approve-choice' }));
  }
  const markdown = await f.request('/api/recap?format=markdown');
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get('content-disposition'), /\.md/);
  assert.match(await markdown.text(), /Optional next step/);
  const action = await f.request('/action/ivn-wildlife-friendly-garden', { redirect: 'manual' });
  assert.equal(action.status, 302);
  assert.match(action.headers.get('location'), /^https:\/\/www\.ivn\.nl\//);
  const events = await (await f.request('/api/events')).json();
  assert.ok(events.some((event) => event.type === 'final-action-viewed'));
  assert.equal(JSON.stringify(events).includes('viewer'), false);
  await f.close();
});

test('live session start is rejected unless the authorized channel is ready and explicitly confirmed', async () => {
  const f = await fixture();
  const result = await f.request('/api/command', post({ command: 'start', payload: { mode: 'live', confirmChannelId: 'wrong' } }));
  assert.equal(result.status, 409);
  assert.equal((await (await f.request('/api/state')).json()).phase, 'ready');
  await f.close();
});

test('live connection loss automatically pauses server timer and reconnect requires operator resume', async () => {
  class FakeTwitch extends EventEmitter {
    constructor() { super(); this.current = { configured: true, connected: true, ready: true, profile: { id: 'broadcaster', login: 'fieldstation', displayName: 'Field Station' }, error: null, lastDeliveryAt: null, transport: 'EventSub connected' }; }
    status() { return this.current; }
    isConfigured() { return true; }
    shutdown() {}
  }
  const store = new Store(':memory:');
  const service = new HabitatService({ store, now: () => 1_000, voteSalt: 'live-pause-test' });
  service.execute('reset', { mode: 'live' });
  service.execute('start', { mode: 'live' });
  const twitch = new FakeTwitch();
  const app = createApp({ store, service, twitch, env: {}, now: () => 1_000, logger: { error: () => {} } });
  await new Promise((resolve, reject) => app.server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const postTo = (command) => fetch(`${base}/api/command`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  twitch.current = { ...twitch.current, ready: false, error: 'Reconnecting to Twitch.' };
  twitch.emit('status', twitch.current);
  assert.equal(service.getState().phase, 'paused');
  assert.equal(service.getState().pausedFrom, 'voting');
  assert.equal((await postTo({ command: 'resume' })).status, 409);
  twitch.current = { ...twitch.current, ready: true, error: null };
  twitch.emit('status', twitch.current);
  assert.equal((await postTo({ command: 'resume' })).status, 200);
  assert.equal(service.getState().phase, 'voting');
  await app.close();
  store.close();
});
