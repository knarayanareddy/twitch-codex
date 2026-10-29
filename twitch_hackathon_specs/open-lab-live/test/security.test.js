import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperatorCookie, hashActor, hashAddress, readCookie, requireSameOrigin, verifyOperatorCookie } from '../src/adapters/security.js';

test('signed operator cookie is expiry-bound, HttpOnly, SameSite and optionally Secure',()=>{
  const secret='known-test-secret'.repeat(4);const header=createOperatorCookie(secret,1000,true);const raw=header.split(';')[0].slice('ol_operator='.length);
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/Secure/);
  assert.equal(verifyOperatorCookie(raw,secret,1001),true);assert.equal(verifyOperatorCookie(raw,secret,9*60*60*1000),false);assert.equal(verifyOperatorCookie(raw+'x',secret,1001),false);
  assert.equal(verifyOperatorCookie(raw,'different-secret'.repeat(4),1001),false);
});

test('identity/address helpers store only keyed digests and cookies parse exact names',()=>{
  assert.equal(hashActor('viewer-123','session-salt'),hashActor('viewer-123','session-salt'));
  assert.notEqual(hashActor('viewer-123','session-salt'),hashActor('viewer-123','other-salt'));
  assert.notEqual(hashAddress('127.0.0.1','secret'),hashAddress('127.0.0.2','secret'));
  assert.equal(readCookie({headers:{cookie:'first=a; ol_operator=abc; last=z'}},'ol_operator'),'abc');
  assert.equal(readCookie({headers:{cookie:'notol_operator=abc'}},'ol_operator'),null);
});

test('mutations require a same-origin header and respect explicitly trusted HTTPS proxy headers',()=>{
  const request={headers:{origin:'http://localhost:4190',host:'localhost:4190'},socket:{encrypted:false}};
  assert.doesNotThrow(()=>requireSameOrigin(request));
  assert.throws(()=>requireSameOrigin({...request,headers:{...request.headers,origin:'https://attacker.example'}}),(error)=>error.status===403);
  const proxied={headers:{origin:'https://open-lab.example',host:'internal:4190','x-forwarded-host':'open-lab.example','x-forwarded-proto':'https'},socket:{encrypted:false}};
  assert.doesNotThrow(()=>requireSameOrigin(proxied,{trustProxy:true}));
});
