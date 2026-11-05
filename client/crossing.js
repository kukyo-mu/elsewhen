// Public, bounded solver. A proof adds enrollment cost; it is not an identity test.
const enc=new TextEncoder();
export function crossingInput(ticket,nonce){return enc.encode(JSON.stringify(['elsewhen-crossing-v1',ticket.origin,ticket.visitor,ticket.seed,ticket.expires,ticket.bits,nonce]))}
export function hasWork(bytes,bits){for(let i=0;i<bits;i++)if(bytes[i>>3]&(128>>(i&7)))return false;return true}
export async function solveCrossing(ticket,{signal,onProgress=()=>{},maxMilliseconds=120000}={}){
 if(ticket?.version!==1||!Number.isInteger(ticket.bits)||ticket.bits<1||ticket.bits>20||!Number.isSafeInteger(ticket.expires)||typeof ticket.seed!=='string'||ticket.seed.length>64)throw Error('Unsupported crossing');
 const start=Date.now();let reported=start;
 for(let attempt=0;attempt<16777216;attempt++){
  if(signal?.aborted)throw Error('Crossing cancelled');
  if(Date.now()>=ticket.expires)throw Error('Crossing expired. Enter again for a fresh one.');
  if(Date.now()-start>maxMilliseconds)throw Error('Crossing paused. Enter again when you choose.');
  const nonce=String(attempt),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',crossingInput(ticket,nonce)));
  if(hasWork(hash,ticket.bits))return {ticket,nonce};
  if(Date.now()-reported>250){onProgress({attempts:attempt+1});reported=Date.now();await new Promise(resolve=>setTimeout(resolve,0))}
 }
 throw Error('Crossing work limit reached. Enter again for a fresh one.');
}
