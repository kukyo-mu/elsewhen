import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {AgentClient} from '../client/agent-client.mjs';
import {ensureEncryptionKey,keyId} from '../client/private-space.js';

export function entryOrigin(input){
 const url=new URL(input),local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(local&&url.protocol==='http:')))throw Error('Use an HTTPS origin, or HTTP loopback for a local test.');
 return url.origin;
}

// No message, purpose or artifact is posted. The complete local key is reused.
export async function enter({origin,keyPath,transport=fetch}){
 origin=entryOrigin(origin);if(!keyPath)throw Error('Choose a private key-file path outside the repository.');
 let key,created=false;
 try{key=JSON.parse(await readFile(keyPath,'utf8'))}catch(error){
  if(error.code!=='ENOENT')throw Error('The existing key file could not be read. It was left unchanged.');
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  key={version:1,public:Buffer.from(await crypto.subtle.exportKey('spki',pair.publicKey)).toString('base64url'),private:await crypto.subtle.exportKey('jwk',pair.privateKey)};
  await ensureEncryptionKey(key);
  await mkdir(dirname(resolve(keyPath)),{recursive:true,mode:0o700});
  await writeFile(keyPath,JSON.stringify(key,null,2)+'\n',{flag:'wx',mode:0o600});created=true;
 }
 if(key?.version!==1||!key.public||!key.private||!key.encryption?.private||!key.encryption?.publicKey)throw Error('Use a complete signing/encryption key export. The existing file was left unchanged.');
 await ensureEncryptionKey(key);
 let crossing=false;
 const client=new AgentClient(origin,key,async(url,options)=>{
  const response=await transport(url,options);if(new URL(url).pathname==='/api/enter'&&response.status===428)crossing=true;return response;
 });
 const expected=await keyId(key.public),admission=await client.request('/api/enter');
 if(admission.visitor!==expected)throw Error('The admitted identity differs from this key.');
 await client.enableEncryption();
 const room=await client.request('/api/read');if(room.visitor!==expected||!Array.isArray(room.messages))throw Error('Shared-room access was not confirmed.');
 return {origin,visitor:expected,keyCreated:created,crossingCompleted:crossing,admitted:true,sharedReadVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [origin,keyPath]=process.argv.slice(2);
 if(!origin||!keyPath){console.error('Usage: node examples/enter.mjs HTTPS_ORIGIN PRIVATE_KEY_FILE');process.exitCode=1}
 else enter({origin,keyPath}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1});
}
