import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enter,entryOrigin} from '../examples/enter.mjs';
import {crossingInput,hasWork} from '../client/crossing.js';
import {keyId,verifyAdvertisement,unb64} from '../client/private-space.js';
const origin='https://elsewhen.example';

// Synthetic protocol fixture: real signatures and proof-of-work, no network.
function fixture(){
 let registered=false,ticket;const paths=[],nonces=new Set();
 const transport=async(url,options)=>{
  const envelope=JSON.parse(options.body),p=JSON.parse(envelope.payload);paths.push(p.path);
  assert.equal(new URL(url).origin,origin);assert.equal(p.origin,origin);assert.equal(p.path,new URL(url).pathname);assert.ok(Math.abs(Date.now()-p.time)<120000);assert.ok(!nonces.has(p.nonce));nonces.add(p.nonce);
  assert.equal('private' in envelope,false);assert.equal('encryption' in envelope,false);
  const key=await crypto.subtle.importKey('spki',unb64(envelope.key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  assert.ok(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(envelope.signature),new TextEncoder().encode(envelope.payload)));
  const visitor=await keyId(envelope.key);
  if(p.path==='/api/enter'){
   if(!registered&&!p.crossing){ticket={version:1,origin,visitor,seed:'synthetic-fixture-seed',expires:Date.now()+600000,bits:8};return Response.json({crossing:ticket},{status:428})}
   if(!registered){assert.deepEqual(p.crossing.ticket,ticket);assert.ok(hasWork(new Uint8Array(await crypto.subtle.digest('SHA-256',crossingInput(ticket,p.crossing.nonce))),ticket.bits));registered=true}
   return Response.json({visitor});
  }
  assert.ok(registered);
  if(p.path==='/api/hub/keys'){assert.ok(await verifyAdvertisement(p.encryption,visitor));return Response.json({id:'identity:'+visitor,body:{encryption:p.encryption}})}
  assert.equal(p.path,'/api/read');return Response.json({visitor,messages:[]});
 };
 return {transport,paths};
}
async function temporary(fn){const folder=await mkdtemp(join(tmpdir(),'elsewhen-entry-'));try{return await fn(join(folder,'visitor.private.json'))}finally{await rm(folder,{recursive:true,force:true})}}
test('first entry saves a complete key, solves a signed crossing and confirms shared access',()=>temporary(async keyPath=>{
 const f=fixture();const result=await enter({origin,keyPath,transport:f.transport});assert.equal(result.keyCreated,true);assert.equal(result.crossingCompleted,true);assert.equal(result.sharedReadVerified,true);
 const key=JSON.parse(await readFile(keyPath,'utf8'));assert.ok(key.private.d);assert.ok(key.encryption.private.d);assert.equal(result.visitor,await keyId(key.public));
 assert.deepEqual(f.paths,['/api/enter','/api/enter','/api/hub/keys','/api/read']);
}));
test('return reuses byte-identical signing/encryption material and performs no crossing or content write',()=>temporary(async keyPath=>{
 const f=fixture(),first=await enter({origin,keyPath,transport:f.transport}),before=await readFile(keyPath);f.paths.length=0;
 const second=await enter({origin,keyPath,transport:f.transport});assert.equal(second.visitor,first.visitor);assert.equal(second.keyCreated,false);assert.equal(second.crossingCompleted,false);assert.ok(before.equals(await readFile(keyPath)));
 assert.deepEqual(f.paths,['/api/enter','/api/hub/keys','/api/read']);
}));
test('a failed connection leaves the complete new key saved before its first request',()=>temporary(async keyPath=>{
 await assert.rejects(enter({origin,keyPath,transport:async()=>{const saved=JSON.parse(await readFile(keyPath,'utf8'));assert.ok(saved.encryption.private.d);throw Error('Offline fixture')}}),/Offline fixture/);
 assert.ok(JSON.parse(await readFile(keyPath,'utf8')).private.d);
}));
test('malformed and signing-only existing files are never replaced',()=>temporary(async keyPath=>{
 for(const content of ['not JSON',JSON.stringify({version:1,public:'older-key',private:{}})]){
  await writeFile(keyPath,content);let called=false;await assert.rejects(enter({origin,keyPath,transport:async()=>{called=true}}));assert.equal(called,false);assert.equal(await readFile(keyPath,'utf8'),content);
 }
}));
test('an unexpected admitted identity stops before public-key publication or reading',()=>temporary(async keyPath=>{
 let calls=0;await assert.rejects(enter({origin,keyPath,transport:async()=>{calls++;return Response.json({visitor:'wrong-identity'})}}),/identity differs/);assert.equal(calls,1);
}));
test('remote HTTPS and plain loopback are supported; credentials, paths and other HTTP hosts are refused',()=>{
 assert.equal(entryOrigin(origin),origin);assert.equal(entryOrigin('http://127.0.0.1:8795'),'http://127.0.0.1:8795');
 for(const url of ['http://elsewhen.example','https://user:password@elsewhen.example','https://elsewhen.example/path','https://elsewhen.example/?key=x','https://elsewhen.example/#fragment'])assert.throws(()=>entryOrigin(url));
});
