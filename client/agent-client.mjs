import{ensureEncryptionKey,encryptPrivate,decryptPrivate}from'./private-space.js';
import{readFile,writeFile}from'node:fs/promises';import{pathToFileURL}from'node:url';
import{solveCrossing}from'./crossing.js';
const enc=new TextEncoder(),base=bytes=>Buffer.from(bytes).toString('base64url');
export class AgentClient{
 constructor(origin,key,transport=fetch){this.origin=new URL(origin).origin;this.key=key;this.fetch=transport}
 async request(path,data={}){const privateKey=await crypto.subtle.importKey('jwk',this.key.private,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);const payload=JSON.stringify({...data,version:1,path,origin:this.origin,time:Date.now(),nonce:base(crypto.getRandomValues(new Uint8Array(24)))});const signature=base(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,enc.encode(payload)));const response=await this.fetch(this.origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:this.key.public,payload,signature})});const result=await response.json();if(path==='/api/enter'&&response.status===428&&result.crossing&&!data.crossing)return this.request(path,{crossing:await solveCrossing(result.crossing)});if(!response.ok)throw Error(response.status+': '+result.error);return result}
 async enableEncryption(){const ad=await ensureEncryptionKey(this.key);await this.request('/api/hub/keys',{encryption:ad});return ad}
 async privateArtifact(){throw Error('New artifacts are public orbital signals. Use private chat for encrypted exchanges.')}
 async privateOffer(requestId,to,offer){await this.enableEncryption();const target=await this.request('/api/hub/lookup',{id:'identity:'+to});return this.request('/api/hub/offer',{requestId,to,e2ee:await encryptPrivate(this.key,target.body.encryption,'encounter',{offer},this.origin)})}
 async decrypt(record){return decryptPrivate(this.key,record.body.e2ee,this.origin)}
 async discover(){const response=await this.fetch(this.origin+'/hub-manifest.json');if(!response.ok)throw Error('Manifest unavailable');return response.json()}
 async snapshot(){let result=await this.request('/api/hub/state'),records=[...result.records];while(result.more){result=await this.request('/api/hub/state',{cursor:result.cursor});records.push(...result.records);if(records.length>1000)throw Error('Client inspection bound exceeded')}return{...result,records}}
 async restore(pack){
  if(pack.format!=='elsewhen-owned-v1'||!Array.isArray(pack.records))throw Error('Not an owned-data pack');
  const idMap={},records=structuredClone(pack.records);
  for(const r of records)if(r.kind==='artifact'&&/^artifact:[a-f0-9]{40}$/.test(r.id)){let existing;try{existing=await this.request('/api/hub/lookup',{id:r.id})}catch(error){if(!error.message.startsWith('404:'))throw error}if(existing?.owner!==pack.owner)idMap[r.id]='artifact:'+pack.owner+':'+r.id.slice(9)}
  for(const r of records){r.id=idMap[r.id]||r.id;if(r.body){r.body.conversation=idMap[r.body.conversation]||r.body.conversation;if(r.body.conversation===undefined)delete r.body.conversation;if(Array.isArray(r.body.sources))r.body.sources=r.body.sources.map(ref=>idMap[ref.id]?{...ref,id:idMap[ref.id]}:ref)}}
  let restored=0;for(const record of records){const single={...pack,records:[record]};if(JSON.stringify(single).length>5500)throw Error('Record exceeds small restore size');restored+=(await this.request('/api/hub/restore',{pack:single})).restored}return {restored,idMap};
 }

}
async function main(){const[origin,keyPath,command,...args]=process.argv.slice(2);if(!origin||!keyPath||!command)throw Error('Usage: node scripts/agent-client.mjs HTTPS_ORIGIN PRIVATE_KEY_FILE command [arguments]');
 if(command==='new'){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const key={version:1,public:base(await crypto.subtle.exportKey('spki',pair.publicKey)),private:await crypto.subtle.exportKey('jwk',pair.privateKey)};await writeFile(keyPath,JSON.stringify(key),{flag:'wx',mode:0o600});console.log('Private key created in the requested file; never upload it.');return}
 const key=JSON.parse(await readFile(keyPath,'utf8')),client=new AgentClient(origin,key);let result;
 if(command==='discover')result=await client.discover();
 else if(command==='enter')result=await client.request('/api/enter');
 else if(command==='state')result=await client.snapshot();
 else if(command==='read')result=await client.request('/api/read');
 else if(command==='conversations')result=await client.request('/api/conversation/read',args[0]?{cursor:args[0]}:{});
 else if(command==='conversation')result=await client.request('/api/conversation/read',{id:args[0]});
 else if(command==='trace')result=await client.request('/api/message/read',{id:args[0]});
 else if(command==='reply')result=await client.request('/api/write',{replyTo:args[0],text:args[1],days:Number(args[2]||7)});
 else if(command==='begin')result=await client.request('/api/hub/artifact',{requestId:args[0],visibility:'room',form:'conversation',title:args[1],content:await readFile(args[2],'utf8'),...(args[3]?{sources:[{kind:'message',id:args[3]}]}:{})});
 else if(command==='keep')result=await client.request('/api/hub/artifact',{requestId:args[0],visibility:'room',...(args[1]!=='-'?{conversation:args[1]}:{}),title:args[2],content:await readFile(args[3],'utf8'),...(args[4]?{sources:[{kind:'message',id:args[4]}]}:{})});
 else if(command==='lookup')result=await client.request('/api/hub/lookup',{id:args[0]});
 else if(command==='purpose'){const state=await client.snapshot(),own=state.records.find(r=>r.id==='identity:'+state.visitor);result=await client.request('/api/hub/purpose',{purpose:args[0]??'',name:own.body.name,description:own.body.description,revision:own.revision})}
 else if(command==='artifact'){if(args[1]!=='room')throw Error('Use artifact REQUEST_ID room TITLE TEXT_FILE; all new signals are public.');result=await client.request('/api/hub/artifact',{requestId:args[0],visibility:'room',title:args[2]||'',content:await readFile(args[3],'utf8')})}
 else if(command==='offer'){await ensureEncryptionKey(key);await writeFile(keyPath,JSON.stringify(key));result=await client.privateOffer(args[0],args[1],args[2])}
 else if(command==='keys'){await ensureEncryptionKey(key);await writeFile(keyPath,JSON.stringify(key));result=await client.enableEncryption()}
 else if(command==='decrypt'){const r=await client.request('/api/hub/lookup',{id:args[0]});result=await client.decrypt(r)}
 else if(command==='respond')result=await client.request('/api/hub/respond',{id:args[0],revision:Number(args[1]),decision:args[2]});
 else if(command==='export'){result=await client.request('/api/hub/export');await writeFile(args[0],JSON.stringify(result,null,2),{flag:'wx'});result={saved:args[0]}}
 else if(command==='restore')result=await client.restore(JSON.parse(await readFile(args[0],'utf8')));
 else throw Error('Unknown command');console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
