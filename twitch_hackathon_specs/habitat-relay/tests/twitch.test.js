import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAuthorizationUrl, TwitchAdapter } from '../src/adapters/twitch.js';
import { Store } from '../src/adapters/store.js';

const jsonResponse = (data, status=200) => ({ ok: status>=200&&status<300, status, json: async()=>data });
class FakeSocket extends EventEmitter {
  static instances=[];
  constructor(url){ super(); this.url=url; this.closed=false; FakeSocket.instances.push(this); }
  close(){ this.closed=true; this.emit('close'); }
}
function adapter(overrides={}) {
  const store = new Store(':memory:');
  const calls=[];
  const fetchImpl = overrides.fetchImpl ?? (async (url,options={})=>{
    calls.push({url:String(url),options});
    if (String(url).includes('/oauth2/token')) return jsonResponse({access_token:'access-secret',refresh_token:'refresh-secret',expires_in:3600,scope:['user:read:chat']});
    if (String(url).includes('/oauth2/validate')) return jsonResponse({scopes:['user:read:chat'],user_id:'123'});
    if (String(url).includes('/helix/users')) return jsonResponse({data:[{id:'123',login:'habitat_host',display_name:'Habitat Host'}]});
    if (String(url).includes('/eventsub/subscriptions')) return jsonResponse({data:[{id:'sub'}]},202);
    return jsonResponse({},404);
  });
  const instance = new TwitchAdapter({
    clientId:'client-id',clientSecret:'client-secret',redirectUri:'http://localhost:3000/auth/twitch/callback',
    store,encryptionKey:Buffer.alloc(32,9),fetchImpl,WebSocketImpl:FakeSocket,now:()=>1000,onChat:overrides.onChat ?? (()=>{}),
    reconnectBaseMs:1000,...overrides,
  });
  return { instance, store, calls };
}

test('authorization URL includes correct response type, scope, state, and callback', () => {
  const url = new URL(createAuthorizationUrl({clientId:'id',redirectUri:'http://localhost/callback',state:'random-state'}));
  assert.equal(url.origin,'https://id.twitch.tv');
  assert.equal(url.searchParams.get('client_id'),'id');
  assert.equal(url.searchParams.get('redirect_uri'),'http://localhost/callback');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('scope'),'user:read:chat');
  assert.equal(url.searchParams.get('state'),'random-state');
});

test('adapter reports missing configuration without leaking secrets', () => {
  const { instance, store } = adapter({clientSecret:undefined,encryptionKey:null});
  const status=instance.status();
  assert.equal(status.configured,false);
  assert.equal(JSON.stringify(status).includes('client-secret'),false);
  assert.throws(()=>instance.authorizeUrl('state'),{code:'NOT_CONFIGURED'});
  store.close();
});

test('authorization rejects missing or mismatched OAuth state', async () => {
  const { instance, store, calls } = adapter();
  await assert.rejects(()=>instance.finishAuthorization({code:'code',stateMatches:false}),{code:'INVALID_STATE'});
  await assert.rejects(()=>instance.finishAuthorization({code:'',stateMatches:true}),{code:'INVALID_CODE'});
  assert.equal(calls.length,0);
  store.close();
});

test('OAuth exchange validates scope, looks up broadcaster, encrypts tokens, and starts EventSub', async () => {
  FakeSocket.instances=[];
  const { instance, store, calls } = adapter();
  const profile=await instance.finishAuthorization({code:'one-time-code',stateMatches:true});
  assert.deepEqual(profile,{id:'123',login:'habitat_host',displayName:'Habitat Host'});
  assert.equal(instance.status().connected,true);
  assert.equal(FakeSocket.instances.length,1);
  assert.equal(calls.some((call)=>String(call.url).includes('/oauth2/token')),true);
  const saved=store.getEncryptedSecret('twitch_tokens');
  assert.ok(saved?.ciphertext);
  assert.equal(saved.ciphertext.includes('access-secret'),false);
  store.close();
});

test('authorization refuses missing required chat scope', async () => {
  const { instance, store } = adapter({fetchImpl:async(url)=>{
    if(String(url).includes('/oauth2/token')) return jsonResponse({access_token:'a',refresh_token:'r',expires_in:1000});
    if(String(url).includes('/oauth2/validate')) return jsonResponse({scopes:['user:write:chat'],user_id:'123'});
    return jsonResponse({});
  }});
  await assert.rejects(()=>instance.finishAuthorization({code:'code',stateMatches:true}),{code:'MISSING_SCOPE'});
  assert.equal(instance.status().connected,false);
  store.close();
});

test('authorization handles token exchange and user lookup failures', async (t) => {
  await t.test('token exchange error',async()=>{
    const {instance,store}=adapter({fetchImpl:async()=>jsonResponse({message:'failed'},400)});
    await assert.rejects(()=>instance.finishAuthorization({code:'code',stateMatches:true}),{code:'TOKEN_EXCHANGE_FAILED'});store.close();
  });
  await t.test('user lookup error',async()=>{
    const {instance,store}=adapter({fetchImpl:async(url)=>String(url).includes('/oauth2/token')?jsonResponse({access_token:'a',refresh_token:'r',expires_in:5000}):String(url).includes('/oauth2/validate')?jsonResponse({scopes:['user:read:chat']}):jsonResponse({},500)});
    await assert.rejects(()=>instance.finishAuthorization({code:'code',stateMatches:true}),{code:'USER_LOOKUP_FAILED'});store.close();
  });
});

test('EventSub welcome subscribes to self channel with WebSocket transport and minimum scope', async () => {
  FakeSocket.instances=[];
  const {instance,store,calls}=adapter();
  await instance.finishAuthorization({code:'code',stateMatches:true});
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{id:'session-abc'}}}));
  const call=calls.find((item)=>String(item.url).includes('/eventsub/subscriptions'));
  assert.ok(call);
  const body=JSON.parse(call.options.body);
  assert.equal(body.type,'channel.chat.message');
  assert.equal(body.version,'1');
  assert.deepEqual(body.condition,{broadcaster_user_id:'123',user_id:'123'});
  assert.deepEqual(body.transport,{method:'websocket',session_id:'session-abc'});
  assert.equal(instance.status().ready,true);
  store.close();
});

test('EventSub notification forwards only normalized chat fields', async () => {
  let received;
  const {instance,store}=adapter({onChat:(event)=>{received=event;}});
  await instance.finishAuthorization({code:'code',stateMatches:true});
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'notification',subscription_type:'channel.chat.message',message_id:'delivery-1'},payload:{event:{broadcaster_user_id:'123',user_id:'123',chatter_user_id:'456',chatter_user_login:'viewer',message:{text:'!habitat 1'}}}}));
  assert.deepEqual(received,{text:'!habitat 1',actorId:'456',chatterLogin:'viewer',deliveryId:'delivery-1',receivedAt:1000});
  store.close();
});

test('EventSub ignores messages outside connected broadcaster and malformed frames', async () => {
  let count=0;
  const {instance,store}=adapter({onChat:()=>count++});
  await instance.finishAuthorization({code:'code',stateMatches:true});
  await instance.handleFrame('not-json');
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'notification',subscription_type:'channel.chat.message',message_id:'bad'},payload:{event:{broadcaster_user_id:'elsewhere',chatter_user_id:'x',message:{text:'!habitat 1'}}}}));
  assert.equal(count,0);
  assert.match(instance.status().error,/unreadable/);
  store.close();
});

test('session keepalive marks transport ready without creating another subscription', async () => {
  const {instance,store,calls}=adapter();
  await instance.finishAuthorization({code:'code',stateMatches:true});
  const before=calls.filter((x)=>String(x.url).includes('/eventsub/subscriptions')).length;
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'session_keepalive'}}));
  assert.equal(instance.status().ready,true);
  assert.equal(calls.filter((x)=>String(x.url).includes('/eventsub/subscriptions')).length,before);
  store.close();
});

test('session migration follows Twitch reconnect URL without resubscribing', async () => {
  FakeSocket.instances=[];
  const {instance,store,calls}=adapter();
  await instance.finishAuthorization({code:'code',stateMatches:true});
  const before=calls.filter((x)=>String(x.url).includes('/eventsub/subscriptions')).length;
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'session_reconnect'},payload:{session:{reconnect_url:'wss://new-eventsub.example/ws'}}}));
  assert.equal(FakeSocket.instances.length,2);
  assert.equal(FakeSocket.instances[1].url,'wss://new-eventsub.example/ws');
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{id:'migrated'}}}),{subscribeOnWelcome:false});
  assert.equal(calls.filter((x)=>String(x.url).includes('/eventsub/subscriptions')).length,before);
  store.close();
});

test('revocation informs operator and does not claim ready', async () => {
  const {instance,store}=adapter();
  await instance.finishAuthorization({code:'code',stateMatches:true});
  await instance.handleFrame(JSON.stringify({metadata:{message_type:'revocation'}}));
  assert.equal(instance.status().ready,false);
  assert.match(instance.status().error,/revoked/);
  store.close();
});

test('refresh token rotates and encrypted token persists', async () => {
  const {instance,store}=adapter({fetchImpl:async(url,options)=>{
    if(String(url).includes('/oauth2/token')) return jsonResponse({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
    return jsonResponse({});
  }});
  instance.tokens={accessToken:'old',refreshToken:'refresh',expiresAt:0,profile:{id:'123',login:'x',displayName:'X'}};
  instance.profile=instance.tokens.profile;
  const token=await instance.refreshAccessToken();
  assert.equal(token,'new-access');
  assert.equal(instance.tokens.refreshToken,'new-refresh');
  assert.ok(store.getEncryptedSecret('twitch_tokens'));
  store.close();
});

test('failed EventSub subscription leaves clear not-ready status', async () => {
  const {instance,store}=adapter({fetchImpl:async(url)=>String(url).includes('/eventsub/subscriptions')?jsonResponse({message:'scope denied'},403):String(url).includes('/oauth2/token')?jsonResponse({access_token:'a',refresh_token:'r',expires_in:6000}):String(url).includes('/oauth2/validate')?jsonResponse({scopes:['user:read:chat']}):String(url).includes('/helix/users')?jsonResponse({data:[{id:'123',login:'host'}]}):jsonResponse({})});
  await instance.finishAuthorization({code:'code',stateMatches:true});
  await assert.rejects(()=>instance.handleFrame(JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{id:'s'}}})),{code:'SUBSCRIPTION_FAILED'});
  assert.equal(instance.status().ready,false);
  assert.match(instance.status().error,/Could not subscribe/);
  store.close();
});

test('disconnect revokes local encrypted credentials and closes the socket', async () => {
  FakeSocket.instances=[];
  const {instance,store}=adapter();
  await instance.finishAuthorization({code:'code',stateMatches:true});
  const socket=FakeSocket.instances[0];
  instance.disconnect();
  assert.equal(socket.closed,true);
  assert.equal(instance.status().connected,false);
  assert.equal(store.getEncryptedSecret('twitch_tokens'),null);
  store.close();
});
