import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { SqliteStore } from './adapters/storage/sqlite-store.js';
import { createOperatorCookie, hashAddress, loadSigningSecret, readCookie, requireSameOrigin, verifyOperatorCookie } from './adapters/security.js';
import { LabService, LabError } from './application/lab-service.js';
import { LESSON } from './domain/lesson.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)); const PUBLIC = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 4190); const HOST = process.env.HOST || '0.0.0.0';
const COOKIE_SECRET = loadSigningSecret({ envValue: process.env.OPEN_LAB_COOKIE_SECRET, filename: path.resolve(process.cwd(), 'data/.open-lab-cookie-key') });
const PASSCODE = process.env.OPEN_LAB_OPERATOR_PASSCODE || (process.env.DEMO_MODE === '1' ? process.env.DEMO_PASSCODE : '') || '';
const demoAuthReady = process.env.DEMO_MODE === '1' && PASSCODE.length >= 12;
const productionAuthReady = PASSCODE.length >= 24 && Boolean(process.env.OPEN_LAB_COOKIE_SECRET);
const authReady = demoAuthReady || productionAuthReady;
const secureCookies = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY_HTTPS === '1';
const trustProxy = process.env.TRUST_PROXY_HTTPS === '1';
const store = new SqliteStore(process.env.DATABASE_PATH || './data/open-lab.sqlite');
const streamClients = new Map(); const requestLimits = new Map();
const service = new LabService({ store, secret: COOKIE_SECRET, onChange: (id) => broadcast(id) });
const responseHeaders = {
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(),microphone=(),geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};
function admin(req) { return verifyOperatorCookie(readCookie(req,'ol_operator'),COOKIE_SECRET); }
function requireAdmin(req) { if (!admin(req)) throw new LabError('AUTH_REQUIRED','Open the field notebook with the operator passphrase.',401); }
function constantTimeEqual(a,b) { const left=Buffer.from(String(a));const right=Buffer.from(String(b));return left.length===right.length&&timingSafeEqual(left,right); }
function send(res,status,value,extra={}) { const body=Buffer.from(typeof value==='string'?value:JSON.stringify(value));res.writeHead(status,{...responseHeaders,'Content-Type':typeof value==='string'?'text/plain; charset=utf-8':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store',...extra});res.end(body); }
function fail(res,error) { const status=Number.isInteger(error.status)?error.status:500;if(status>=500)console.error(`[open-lab] ${error.name||'Error'}: ${error.message}`);send(res,status,{error:{code:error.code||(status>=500?'INTERNAL_ERROR':'REQUEST_REJECTED'),message:status>=500?'The lab could not complete that action. No viewer data was exposed.':error.message}}); }
function cookieClear() { return `ol_operator=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookies?'; Secure':''}`; }
async function bodyText(req,max=8*1024) { let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new LabError('BODY_TOO_LARGE','Request body is too large.',413);chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8'); }
async function jsonBody(req) { if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new LabError('CONTENT_TYPE_REQUIRED','Send a JSON request.',415);try{return JSON.parse(await bodyText(req));}catch(error){if(error instanceof LabError)throw error;throw new LabError('INVALID_JSON','Request body is not valid JSON.',400);} }
function rateLimit(req,key,max=40) { const hashed=hashAddress(`${key}:${req.socket.remoteAddress||'unknown'}`,COOKIE_SECRET);const now=Date.now();const recent=(requestLimits.get(hashed)||[]).filter((stamp)=>now-stamp<60_000);if(recent.length>=max)throw new LabError('RATE_LIMITED','Please wait a moment before trying again.',429);recent.push(now);requestLimits.set(hashed,recent);if(requestLimits.size>4000)for(const[id,times]of requestLimits)if(!times.some((time)=>now-time<60_000))requestLimits.delete(id); }
function staticFile(res,relative) { const file=path.resolve(PUBLIC,relative);if(!file.startsWith(PUBLIC+path.sep))return send(res,404,'Not found');try{const data=fs.readFileSync(file);const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};res.writeHead(200,{...responseHeaders,'Content-Type':types[ext]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-cache'});res.end(data);}catch{send(res,404,'Not found');} }
function currentSession() { const record=service.current();return record?service.operatorSnapshot(record.id):null; }
function broadcast(id) { const clients=streamClients.get(id);if(!clients?.size)return;for(const client of clients){try{const snapshot=client.operator?service.operatorSnapshot(id):service.publicSnapshot(id);if(snapshot)client.res.write(`event: snapshot\ndata: ${JSON.stringify({snapshot})}\n\n`);}catch{clients.delete(client);}} }
function openStream(req,res,id,{operator=false}={}) { if(operator)requireAdmin(req);const snapshot=operator?service.operatorSnapshot(id):service.publicSnapshot(id);if(!snapshot)throw new LabError('SESSION_NOT_FOUND','Experiment session not found or expired.',404);res.writeHead(200,{...responseHeaders,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',Connection:'keep-alive'});res.write(`event: snapshot\ndata: ${JSON.stringify({snapshot})}\n\n`);const client={res,operator};if(!streamClients.has(id))streamClients.set(id,new Set());streamClients.get(id).add(client);const keepAlive=setInterval(()=>{try{res.write(': keep-alive\n\n');}catch{}},20_000);keepAlive.unref?.();res.on('close',()=>{clearInterval(keepAlive);streamClients.get(id)?.delete(client);}); }
function recapMarkdown(runs) {
  const lines=['# Open Lab Live — run notes','','Schema version: 1',`Exported ${new Date().toISOString()}`,'','> SIMULATION: These are deterministic model outputs, not measurements, temperature predictions, or climate forecasts.'];
  if(!runs.length)lines.push('','No revealed runs are available.');
  for(const run of runs){const selected=run.testedParameter;lines.push('','---','',`## Run ${run.cycle} · ${run.lessonId} v${run.lessonVersion}`,'',`- Question: ${run.question}`,`- Prediction sample: ${run.predictionTotal}` ,`- Leading prediction: ${run.leadingPrediction?.label|| (run.predictionOutcome==='tie'?'Tie':'No predictions')}`,`- Tested condition: ${selected?.label||'none'}${selected?` (${selected.albedoPercent}% model reflectivity)`:''}`,`- Incoming: ${run.result.tested.incomingEnergy} model units`,`- Absorbed: ${run.result.tested.absorbedEnergy} model units`,`- Reflected: ${run.result.tested.reflectedEnergy} model units`,`- Rule: ${run.simulation.id} — ${run.simulation.formula}`,`- Seed: ${run.seed}`,`- Revealed: ${new Date(run.revealedAt).toISOString()}`,'',run.result.explanation,'','### Assumptions',...run.assumptions.map((item)=>`- ${item}`),'',`### Source: ${run.source.publisher} — ${run.source.title}`,run.source.url,run.source.supports,`Checked ${run.source.checked}`);}
  return `${lines.join('\n')}\n`;
}
store.prune(Date.now());

const server=http.createServer(async(req,res)=>{
  let url;try{url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);}catch{return send(res,400,{error:{code:'BAD_URL',message:'Invalid URL.'}});}
  const method=req.method||'GET';
  try{
    if(method==='GET'&&url.pathname==='/api/health')return send(res,200,{status:'ok',database:'ready',lesson:LESSON.id,lessonVersion:LESSON.version,modelProvider:'none',twitchIntegration:'pending'});
    if(method==='POST'&&url.pathname==='/api/test/reset'){
      if(process.env.NODE_ENV!=='test'||process.env.OPEN_LAB_TEST_MODE!=='1')throw new LabError('NOT_FOUND','Not found.',404);
      requireSameOrigin(req,{trustProxy});requireAdmin(req);store.db.prepare('DELETE FROM lab_sessions').run();requestLimits.clear();return send(res,200,{reset:true});
    }
    if(method==='GET'&&url.pathname==='/api/auth/status')return send(res,200,{authenticated:admin(req),authReady,demoMode:demoAuthReady});
    if(method==='POST'&&url.pathname==='/api/auth/login'){
      requireSameOrigin(req,{trustProxy});rateLimit(req,'login',8);const input=await jsonBody(req);if(!authReady)throw new LabError('AUTH_NOT_CONFIGURED','Set a local operator passphrase before opening the field notebook.',503);
      if(typeof input.passcode!=='string'||!constantTimeEqual(input.passcode,PASSCODE))throw new LabError('AUTH_INVALID','That passphrase did not match.',401);
      const value=createOperatorCookie(COOKIE_SECRET,Date.now(),secureCookies);return send(res,200,{authenticated:true,demoMode:demoAuthReady},{'Set-Cookie':value});
    }
    if(method==='POST'&&url.pathname==='/api/auth/logout'){requireSameOrigin(req,{trustProxy});return send(res,200,{ok:true},{'Set-Cookie':cookieClear()});}
    if(method==='GET'&&url.pathname==='/api/lesson')return send(res,200,LESSON);
    if(method==='GET'&&url.pathname==='/api/studio'){requireAdmin(req);return send(res,200,{lesson:LESSON,session:currentSession(),twitch:{state:'not-configured',integrationPending:true},authReady});}
    if(method==='POST'&&url.pathname==='/api/sessions'){
      requireSameOrigin(req,{trustProxy});requireAdmin(req);const input=await jsonBody(req);if(input.mode!=='demo')throw new LabError('LIVE_INTEGRATION_PENDING','Only the local demo is implemented; Twitch integration is the remaining step.',409);
      const existing=service.current();if(existing&&existing.state.phase!=='closed')throw new LabError('SESSION_ALREADY_ACTIVE','End or reset the current demo session before starting another.',409);
      const session=service.startDemo();return send(res,201,{snapshot:service.operatorSnapshot(session.id),overlayUrl:`/overlay?session=${encodeURIComponent(session.id)}`});
    }
    if(method==='POST'&&url.pathname.startsWith('/api/sessions/')){
      requireSameOrigin(req,{trustProxy});requireAdmin(req);const match=url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/([a-z-]+)$/i);if(!match)throw new LabError('NOT_FOUND','Session action not found.',404);
      const[,id,action]=match;const input=await jsonBody(req);const record=store.getSession(id);if(!record||record.expiresAt<=Date.now())throw new LabError('SESSION_NOT_FOUND','Experiment session not found or expired.',404);
      if(action==='demo-vote'){if(record.state.mode!=='demo')throw new LabError('DEMO_ONLY','Sample predictions are only available in Demo mode.',409);const result=service.simulatePrediction({sessionId:id,voterId:input.voterId,choiceNumber:input.choiceNumber});return send(res,200,{accepted:result.accepted,reason:result.reason,snapshot:service.operatorSnapshot(id)});}
      const controls={'start-predictions':'START_PREDICTIONS','close-predictions':'CLOSE_PREDICTIONS','select-parameter':'SELECT_PARAMETER','run-experiment':'RUN_EXPERIMENT','reveal-result':'REVEAL_RESULT','pause':'PAUSE','resume':'RESUME','replay':'REPLAY','reset':'RESET','end':'END_SESSION'};
      const type=controls[action];if(!type)throw new LabError('NOT_FOUND','Session action not found.',404);
      const details=type==='SELECT_PARAMETER'?{choiceId:input.choiceId}:{};const next=service.control(id,type,details);return send(res,200,{snapshot:service.operatorSnapshot(next.id)});
    }
    if(method==='GET'&&url.pathname==='/api/recap'){requireAdmin(req);return send(res,200,{schemaVersion:1,runs:service.recap()});}
    if(method==='GET'&&url.pathname==='/api/recap/export.json'){
      requireAdmin(req);const data=JSON.stringify({schemaVersion:1,lesson:{id:LESSON.id,version:LESSON.version},simulationNotice:'Rule-based simulation; not a real measurement.',runs:service.recap()},null,2);res.writeHead(200,{...responseHeaders,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="open-lab-runs-v1.json"','Cache-Control':'no-store','Content-Length':Buffer.byteLength(data)});return res.end(data);
    }
    if(method==='GET'&&url.pathname==='/api/recap/export.md'){
      requireAdmin(req);const data=recapMarkdown(service.recap());res.writeHead(200,{...responseHeaders,'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="open-lab-run-notes.md"','Cache-Control':'no-store','Content-Length':Buffer.byteLength(data)});return res.end(data);
    }
    if(method==='GET'&&url.pathname.startsWith('/api/studio/')){const match=url.pathname.match(/^\/api\/studio\/([a-f0-9-]{36})\/events$/i);if(!match)throw new LabError('NOT_FOUND','Not found.',404);return openStream(req,res,match[1],{operator:true});}
    if(method==='GET'&&url.pathname.startsWith('/api/overlay/')){
      const match=url.pathname.match(/^\/api\/overlay\/([a-f0-9-]{36})(?:\/events)?$/i);if(!match)throw new LabError('NOT_FOUND','Overlay not found.',404);if(url.pathname.endsWith('/events'))return openStream(req,res,match[1]);const snapshot=service.publicSnapshot(match[1]);if(!snapshot)throw new LabError('SESSION_NOT_FOUND','Overlay session not found or expired.',404);return send(res,200,{snapshot});
    }
    if(method==='GET'&&url.pathname==='/')return staticFile(res,'index.html');
    if(method==='GET'&&url.pathname==='/overlay')return staticFile(res,'overlay.html');
    if(method==='GET'&&url.pathname==='/privacy')return staticFile(res,'privacy.html');
    if(method==='GET'&&url.pathname.startsWith('/public/')){const relative=path.normalize(url.pathname.slice('/public/'.length)).replace(/^\.\.(?:[\\/]|$)+/,'');const file=path.resolve(PUBLIC,relative);if(!file.startsWith(PUBLIC+path.sep))throw new LabError('NOT_FOUND','Not found.',404);return staticFile(res,file);}
    return send(res,404,{error:{code:'NOT_FOUND',message:'Not found.'}});
  }catch(error){fail(res,error);}
});
const tickTimer=setInterval(()=>service.tickAll(),250);tickTimer.unref?.();
const pruneTimer=setInterval(()=>service.pruneExpired(),60_000);pruneTimer.unref?.();
const rateTimer=setInterval(()=>{const now=Date.now();for(const[key,times]of requestLimits){const fresh=times.filter((time)=>now-time<60_000);if(fresh.length)requestLimits.set(key,fresh);else requestLimits.delete(key);}},60_000);rateTimer.unref?.();
server.on('close',()=>{clearInterval(tickTimer);clearInterval(pruneTimer);clearInterval(rateTimer);for(const clients of streamClients.values())for(const client of clients)client.res.end();store.close();});
server.listen(PORT,HOST,()=>console.log(`[open-lab] listening on http://${HOST}:${PORT}; authReady=${authReady}; lesson=${LESSON.id}@${LESSON.version}; twitch=pending`));
