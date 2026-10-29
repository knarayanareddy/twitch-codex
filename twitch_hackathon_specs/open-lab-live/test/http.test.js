import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise((resolve)=>server.close(resolve));return port;}
async function waitFor(url,child){const until=Date.now()+10_000;while(Date.now()<until){if(child.exitCode!==null)throw new Error(`server exited: ${child.logs}`);try{const response=await fetch(url);if(response.ok)return;}catch{}await new Promise((resolve)=>setTimeout(resolve,80));}throw new Error(`server did not start: ${child.logs}`);}

test('HTTP app protects operator actions, serves safe overlay, and exports aggregate recap', {timeout:30_000}, async(t)=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'open-lab-http-'));const port=await freePort();
  const env={...process.env,HOST:'0.0.0.0',PORT:String(port),NODE_ENV:'test',DEMO_MODE:'1',DEMO_PASSCODE:'integration-passphrase',OPEN_LAB_COOKIE_SECRET:'c'.repeat(64),OPEN_LAB_TEST_MODE:'1',DATABASE_PATH:path.join(temp,'lab.sqlite')};
  const child=spawn(process.execPath,['src/server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});child.logs='';child.stdout.on('data',(data)=>child.logs+=data);child.stderr.on('data',(data)=>child.logs+=data);
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise((resolve)=>setTimeout(resolve,2000))]);}await fs.rm(temp,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;await waitFor(`${base}/api/health`,child);
  const request=async(route,{method='GET',body,cookie}={})=>fetch(`${base}${route}`,{method,headers:{...(method!=='GET'?{Origin:base,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const health=await (await request('/api/health')).json();assert.equal(health.twitchIntegration,'pending');assert.equal(health.modelProvider,'none');
  assert.equal((await request('/api/studio')).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{passcode:'wrong-passcode'}})).status,401);
  const login=await request('/api/auth/login',{method:'POST',body:{passcode:'integration-passphrase'}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/auth/status',{cookie})).ok,true);
  const noOrigin=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:'integration-passphrase'})});assert.equal(noOrigin.status,403,'missing origin is rejected');
  const create=await request('/api/sessions',{method:'POST',body:{mode:'demo'},cookie});assert.equal(create.status,201);const initial=(await create.json()).snapshot;const id=initial.sessionId;
  const start=await request(`/api/sessions/${id}/start-predictions`,{method:'POST',body:{},cookie});assert.equal(start.status,200);
  for(const [voterId,choiceNumber] of [['sample-1',1],['sample-2',1],['sample-3',2]]){
    const vote=await request(`/api/sessions/${id}/demo-vote`,{method:'POST',body:{voterId,choiceNumber},cookie});assert.equal(vote.status,200);assert.equal((await vote.json()).accepted,true);
  }
  const unauth=await request(`/api/sessions/${id}/close-predictions`,{method:'POST',body:{}});assert.equal(unauth.status,401);
  const stream=await fetch(`${base}/api/overlay/${id}/events`);assert.equal(stream.status,200);const reader=stream.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/event: snapshot/);
  await request(`/api/sessions/${id}/close-predictions`,{method:'POST',body:{},cookie}).then(async(r)=>assert.equal(r.status,200));
  const next=await Promise.race([reader.read(),new Promise((resolve)=>setTimeout(()=>resolve({timeout:true}),2000))]);assert.equal(next.timeout,undefined,'SSE connection receives a phase update after the request has completed');assert.match(new TextDecoder().decode(next.value),/"phase":"choose"/);await reader.cancel();
  const chosen=await request(`/api/sessions/${id}/select-parameter`,{method:'POST',body:{choiceId:'dark'},cookie});assert.equal(chosen.status,200);
  assert.equal((await request(`/api/overlay/${id}`)).status,200);
  const privateBefore=await (await request(`/api/overlay/${id}`)).json();assert.equal(privateBefore.snapshot.seed,undefined);assert.equal(privateBefore.snapshot.selectedChoiceId,null);assert.equal(privateBefore.snapshot.result,null);
  await request(`/api/sessions/${id}/run-experiment`,{method:'POST',body:{},cookie}).then(async(r)=>assert.equal(r.status,200));
  const hidden=await (await request(`/api/overlay/${id}`)).json();assert.equal(hidden.snapshot.result,null);
  await request(`/api/sessions/${id}/reveal-result`,{method:'POST',body:{},cookie}).then(async(r)=>assert.equal(r.status,200));
  const revealed=await (await request(`/api/overlay/${id}`)).json();assert.ok(revealed.snapshot.result);assert.equal(revealed.snapshot.seed,undefined);
  const recap=await (await request('/api/recap',{cookie})).json();assert.equal(recap.runs.length,1);assert.equal(recap.runs[0].predictionTotal,3);assert.equal(recap.runs[0].testedParameter.id,'dark');assert.equal(recap.runs[0].question,'With the same incoming light, which surface will absorb the most in this model?');assert.equal(recap.runs[0].simulation.id,'absorbed-fraction-v1');
  const json=await request('/api/recap/export.json',{cookie});assert.equal(json.status,200);assert.match(json.headers.get('content-disposition'),/open-lab-runs-v1\.json/);const exported=await json.json();assert.equal(exported.schemaVersion,1);assert.equal(exported.runs.length,1);assert.ok(exported.runs[0].assumptions.length);assert.equal(exported.runs[0].simulation.id,'absorbed-fraction-v1');
  const markdown=await request('/api/recap/export.md',{cookie});assert.equal(markdown.status,200);const md=await markdown.text();assert.match(md,/Schema version: 1/);assert.match(md,/SIMULATION/);assert.match(md,/not measurements, temperature predictions/);assert.match(md,/Rule: absorbed-fraction-v1/);assert.match(md,/supports the principle/);
  const csp=(await request('/')).headers.get('content-security-policy');assert.match(csp,/default-src 'self'/);assert.match(csp,/frame-ancestors 'self'/);
});
