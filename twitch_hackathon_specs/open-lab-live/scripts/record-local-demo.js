import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PASSCODE=process.env.OPEN_LAB_DEMO_PASSCODE;
const OUTPUT=path.resolve(ROOT,process.env.OPEN_LAB_VIDEO_PATH||'docs/open-lab-local-demo.webm');
if(!PASSCODE||PASSCODE.length<12)throw new Error('Set OPEN_LAB_DEMO_PASSCODE to a local demo passphrase of at least 12 characters.');

async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise((resolve)=>server.close(resolve));return port;}
async function stopChild(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise((resolve)=>setTimeout(resolve,2500))]);if(child.exitCode===null)child.kill('SIGKILL');}
const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'open-lab-record-'));const port=await freePort();
let serverProcess=null;let browser=null;let context=null;let video=null;let recordingError=null;
try{
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',DEMO_MODE:'1',DEMO_PASSCODE:PASSCODE,OPEN_LAB_COOKIE_SECRET:randomBytes(32).toString('hex'),DATABASE_PATH:path.join(tempDir,'record.sqlite')};
  serverProcess=spawn(process.execPath,['src/server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});serverProcess.logs='';serverProcess.stdout.on('data',(chunk)=>serverProcess.logs+=chunk);serverProcess.stderr.on('data',(chunk)=>serverProcess.logs+=chunk);
  const base=`http://127.0.0.1:${port}`;const deadline=Date.now()+10_000;
  while(Date.now()<deadline){if(serverProcess.exitCode!==null)throw new Error(`Isolated demo server exited: ${serverProcess.logs}`);try{const response=await fetch(`${base}/api/health`);if(response.ok)break;}catch{}await new Promise((resolve)=>setTimeout(resolve,80));}
  if(Date.now()>=deadline)throw new Error(`Isolated demo server did not start: ${serverProcess.logs}`);
  await fs.mkdir(path.dirname(OUTPUT),{recursive:true});
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:tempDir,size:{width:1440,height:900}},reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
  const pause=(ms=1000)=>new Promise((resolve)=>setTimeout(resolve,ms));
  await page.goto(base);await page.getByLabel('Operator passphrase').fill(PASSCODE);await page.getByRole('button',{name:/Open the field notebook/}).click();
  await page.getByRole('heading',{name:'A small model, clearly bounded.'}).waitFor();await pause(1100);
  await page.locator('.lesson-disclosure summary').click();await pause(1200);
  await page.getByRole('button',{name:/Start demo predictions/}).click();await page.locator('#phase-tag').getByText('PREDICT').waitFor({state:'visible'});await pause(1500);
  await page.locator('#demo-voter').selectOption('sample-1');await page.locator('#demo-choice').selectOption('1');await page.getByRole('button',{name:'Add simulated prediction'}).click();await pause(1000);
  await page.locator('#demo-voter').selectOption('sample-2');await page.locator('#demo-choice').selectOption('2');await page.getByRole('button',{name:'Add simulated prediction'}).click();await pause(1200);
  await page.getByRole('button',{name:'Close predictions'}).click();await page.locator('#phase-tag').getByText('CHOOSE').waitFor({state:'visible'});await pause(1200);
  await page.getByLabel(/Mid-tone surface/).focus();await page.keyboard.press('Space');await pause(900);
  await page.getByRole('button',{name:'Run experiment'}).click();await page.locator('#phase-tag').getByText('REVEAL').waitFor({state:'visible'});await pause(1500);
  await page.getByRole('button',{name:'Reveal result'}).click();await page.locator('#phase-tag').getByText('LEARN').waitFor({state:'visible'});const overlayFrame=page.frameLocator('#overlay-preview');await overlayFrame.locator('#result-assumptions').waitFor({state:'visible'});await pause(2200);
  const recapSummary=page.locator('#recap-list .recap-notes summary');if(await recapSummary.count())await recapSummary.first().click();await pause(1800);
  if(errors.length)throw new Error(`Browser errors during recording: ${errors.join('; ')}`);
  video=page.video();
}catch(error){recordingError=error;}
finally{
  if(context)await context.close();if(browser)await browser.close();
  if(serverProcess)await stopChild(serverProcess);
  if(video){const source=await video.path();await fs.rename(source,OUTPUT).catch(async()=>{await fs.copyFile(source,OUTPUT);await fs.rm(source,{force:true});});}
  await fs.rm(tempDir,{recursive:true,force:true});
}
if(recordingError)throw recordingError;
console.log(`Wrote local simulation demo (not Twitch evidence): ${OUTPUT}`);
