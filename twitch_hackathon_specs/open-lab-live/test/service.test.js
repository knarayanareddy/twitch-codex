import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../src/adapters/storage/sqlite-store.js';
import { LabService } from '../src/application/lab-service.js';
import { LESSON } from '../src/domain/lesson.js';

test('service persists aggregate-only, deduplicated predictions and revealed recap across reopen', () => {
  let now=1_000; const store=new SqliteStore(':memory:');
  const service=new LabService({store,secret:'x'.repeat(64),clock:()=>now,idFactory:randomUUID,seedFactory:()=> 'stable-seed'});
  const session=service.startDemo(); assert.equal(session.state.phase,'ready');
  service.control(session.id,'START_PREDICTIONS');
  const choice=LESSON.choices[0];
  const vote=service.simulatePrediction({sessionId:session.id,voterId:'sample-1',choiceNumber:choice.number});
  assert.equal(vote.accepted,true);
  const duplicate=service.simulatePrediction({sessionId:session.id,voterId:'sample-1',choiceNumber:choice.number});
  assert.equal(duplicate.accepted,false); assert.equal(duplicate.reason,'already-predicted');
  service.simulatePrediction({sessionId:session.id,voterId:'sample-2',choiceNumber:choice.number});
  assert.equal(service.operatorSnapshot(session.id).predictionTotal,2);
  service.control(session.id,'CLOSE_PREDICTIONS');
  service.control(session.id,'SELECT_PARAMETER',{choiceId:choice.id});
  service.control(session.id,'RUN_EXPERIMENT');
  assert.equal(service.publicSnapshot(session.id).result,null);
  service.control(session.id,'REVEAL_RESULT');
  const recap=service.recap();assert.equal(recap.length,1);assert.equal(recap[0].predictionTotal,2);assert.equal(recap[0].seed,'stable-seed');
  assert.equal(store.aggregates(session.id).reduce((sum,row)=>sum+row.count,0),2);
  const stored=store.getSession(session.id);assert.equal(stored.identitySalt.length,64);assert.equal(JSON.stringify(stored).includes('sample-1'),false);
  store.close();
});

test('SQLite store survives a close/reopen and expiry pruning cascades private aggregates', async () => {
  const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'open-lab-test-'));const filename=path.join(dir,'store.sqlite');
  try{
    let store=new SqliteStore(filename);const service=new LabService({store,secret:'s'.repeat(48),clock:()=>10_000,idFactory:()=> 'persistent-session',seedFactory:()=> 'persist-seed'});
    const session=service.startDemo();service.control(session.id,'START_PREDICTIONS');service.simulatePrediction({sessionId:session.id,voterId:'sample-1',choiceNumber:1});store.close();
    store=new SqliteStore(filename);assert.equal(store.getSession('persistent-session').state.predictionTotal,1);assert.equal(store.aggregates('persistent-session')[0].count,1);
    assert.equal(store.prune(10_000+24*60*60*1000),1);assert.equal(store.getSession('persistent-session'),null);assert.deepEqual(store.aggregates('persistent-session'),[]);store.close();
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
