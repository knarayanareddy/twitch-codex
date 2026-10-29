import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/adapters/store.js';
import { createSession, startSession, castVote } from '../src/domain/engine.js';

function seededStore() {
  const store = new Store(':memory:');
  const initial = createSession({ id:'s1', now:100 });
  store.commitState(initial, { type:'created', payload:{ mode:'demo' }, createdAt:100 });
  return { store, initial };
}

test('store initializes active state, event, and schema', () => {
  const { store, initial } = seededStore();
  assert.equal(store.loadState().id, initial.id);
  assert.equal(store.listEvents('s1')[0].type, 'created');
  store.close();
});

test('state commit uses expected revision and persists new JSON', () => {
  const { store, initial } = seededStore();
  const next = startSession(initial,{now:200,roundDurationMs:5000});
  const result = store.commitState(next,{type:'started',payload:{},createdAt:200},{expectedRevision:0});
  assert.equal(result.committed,true);
  assert.equal(store.loadState().phase,'voting');
  store.close();
});

test('stale expected revision rejects and rolls back event insert', () => {
  const { store, initial } = seededStore();
  const next = startSession(initial,{now:200,roundDurationMs:5000});
  store.commitState(next,{type:'started',payload:{},createdAt:200},{expectedRevision:0});
  assert.throws(()=>store.commitState({ ...next, revision:2 },{type:'stale',payload:{},createdAt:300},{expectedRevision:0}),{code:'REVISION_CONFLICT'});
  assert.equal(store.listEvents('s1').some((e)=>e.type==='stale'),false);
  store.close();
});

test('duplicate delivery id returns safe no-op', () => {
  const { store, initial } = seededStore();
  let state = startSession(initial,{now:200,roundDurationMs:5000});
  store.commitState(state,{type:'started',payload:{},createdAt:200},{expectedRevision:0});
  const next = castVote(state,'wildflower-strip',{now:300});
  assert.equal(store.commitState(next,{type:'vote',payload:{},createdAt:300},{expectedRevision:state.revision,deliveryId:'evt-1'}).committed,true);
  state = next;
  const next2 = castVote(state,'lighter-mowing',{now:301});
  const duplicate = store.commitState(next2,{type:'duplicate',payload:{},createdAt:301},{expectedRevision:state.revision,deliveryId:'evt-1'});
  assert.deepEqual(duplicate,{committed:false,reason:'duplicate-delivery'});
  store.close();
});

test('duplicate actor vote is detected transactionally', () => {
  const { store, initial } = seededStore();
  let state = startSession(initial,{now:200,roundDurationMs:5000});
  store.commitState(state,{type:'started',payload:{},createdAt:200},{expectedRevision:0});
  let next = castVote(state,'wildflower-strip',{now:300});
  store.commitState(next,{type:'vote',payload:{},createdAt:300},{expectedRevision:state.revision,actorHash:'h1',roundId:'flowers'});
  state = next;
  next = castVote(state,'lighter-mowing',{now:301});
  const duplicate = store.commitState(next,{type:'vote',payload:{},createdAt:301},{expectedRevision:state.revision,actorHash:'h1',roundId:'flowers'});
  assert.deepEqual(duplicate,{committed:false,reason:'duplicate-vote'});
  assert.equal(store.loadState().votes['lighter-mowing'],0);
  store.close();
});

test('new delivery ID is consumed when actor duplicate is rejected', () => {
  const { store, initial } = seededStore();
  const state = startSession(initial,{now:200,roundDurationMs:5000});
  store.commitState(state,{type:'started',payload:{},createdAt:200},{expectedRevision:0});
  const one = castVote(state,'wildflower-strip',{now:300});
  store.commitState(one,{type:'vote',payload:{},createdAt:300},{expectedRevision:state.revision,actorHash:'h1',roundId:'flowers'});
  const two = castVote(one,'lighter-mowing',{now:301});
  const duplicate = store.commitState(two,{type:'vote',payload:{},createdAt:301},{expectedRevision:one.revision,actorHash:'h1',roundId:'flowers',deliveryId:'evt-repeat'});
  assert.equal(duplicate.reason,'duplicate-vote');
  const replay = store.commitState(two,{type:'vote',payload:{},createdAt:302},{expectedRevision:one.revision,deliveryId:'evt-repeat'});
  assert.equal(replay.reason,'duplicate-delivery');
  store.close();
});

test('event list is ordered and bounded', () => {
  const { store } = seededStore();
  for (let i=0;i<10;i++) store.db.prepare('INSERT INTO events(session_id,type,payload_json,created_at) VALUES(?,?,?,?)').run('s1',`e${i}`,'{}',i);
  const events = store.listEvents('s1',3);
  assert.equal(events.length,3);
  assert.deepEqual(events.map((e)=>e.type),['e7','e8','e9']);
  assert.equal(store.listEvents('s1',-1).length,1);
  store.close();
});

test('encrypted secret upsert, read, delete', () => {
  const { store } = seededStore();
  const record = { nonce:'n', ciphertext:'c', authTag:'t' };
  store.setEncryptedSecret('tokens',record,100);
  assert.deepEqual(store.getEncryptedSecret('tokens'),record);
  store.setEncryptedSecret('tokens',{...record,ciphertext:'new'},200);
  assert.equal(store.getEncryptedSecret('tokens').ciphertext,'new');
  store.deleteSecret('tokens');
  assert.equal(store.getEncryptedSecret('tokens'),null);
  store.close();
});

test('identity and delivery rows can be removed at session reset', () => {
  const { store, initial } = seededStore();
  store.db.prepare('INSERT INTO accepted_voters(session_id,round_id,actor_hash,accepted_at) VALUES(?,?,?,?)').run(initial.id,'flowers','hash',100);
  store.db.prepare('INSERT INTO delivery_ids(session_id,delivery_id,received_at) VALUES(?,?,?)').run(initial.id,'event',100);
  store.clearVoteIdentity(initial.id);
  assert.equal(store.db.prepare('SELECT count(*) n FROM accepted_voters').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM delivery_ids').get().n,0);
  store.close();
});

test('corrupt persisted state produces an explicit store error', () => {
  const { store } = seededStore();
  store.db.prepare('UPDATE active_state SET state_json=? WHERE singleton=1').run('{broken');
  assert.throws(()=>store.loadState(),{code:'CORRUPT_STATE'});
  store.close();
});
