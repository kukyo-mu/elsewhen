// WebCrypto ECDH P-256 -> HKDF-SHA256 -> AES-256-GCM, with signed key advertisements.
// Static encryption keys: no forward secrecy or protection from a compromised client.
const enc=new TextEncoder(),dec=new TextDecoder();
export const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const signKey=k=>crypto.subtle.importKey('jwk',k.private,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const sign=async(k,data)=>b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await signKey(k),enc.encode(JSON.stringify(data))));
const adFields=a=>({version:a.version,owner:a.owner,signingKey:a.signingKey,publicKey:a.publicKey});
export async function keyId(publicKey){const key=await crypto.subtle.importKey('spki',unb64(publicKey),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);return b64(await crypto.subtle.digest('SHA-256',await crypto.subtle.exportKey('spki',key)))}
export async function verifyAdvertisement(ad,owner){
 try{if(!ad||Object.keys(ad).some(k=>!['version','owner','signingKey','publicKey','signature'].includes(k))||ad?.version!==1||ad.owner!==owner||typeof owner!=='string'||owner.length!==43||typeof ad.signingKey!=='string'||ad.signingKey.length>256||typeof ad.publicKey!=='string'||ad.publicKey.length>256||typeof ad.signature!=='string'||ad.signature.length>128||await keyId(ad.signingKey)!==owner)return false;
 await crypto.subtle.importKey('spki',unb64(ad.publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const pub=await crypto.subtle.importKey('spki',unb64(ad.signingKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,unb64(ad.signature),enc.encode(JSON.stringify(adFields(ad))));}catch{return false}
}
export async function ensureEncryptionKey(key){
 if(!key.encryption){const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);key.encryption={publicKey:b64(await crypto.subtle.exportKey('spki',pair.publicKey)),private:await crypto.subtle.exportKey('jwk',pair.privateKey)}}
 const own=await crypto.subtle.importKey('jwk',key.encryption.private,{name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const jwk=await crypto.subtle.exportKey('jwk',own);delete jwk.d;jwk.key_ops=[];
 const pub=await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},true,[]);
 if(b64(await crypto.subtle.exportKey('spki',pub))!==key.encryption.publicKey)throw Error('Encryption key pair does not match');
 const advertisement={version:1,owner:await keyId(key.public),signingKey:key.public,publicKey:key.encryption.publicKey};advertisement.signature=await sign(key,advertisement);return advertisement;
}
const header=e=>({version:e.version,type:e.type,origin:e.origin,sender:e.sender,recipient:e.recipient,salt:e.salt,iv:e.iv});
const signedFields=e=>({...header(e),ciphertext:e.ciphertext});
async function aesKey(key,peer,e){
 const priv=await crypto.subtle.importKey('jwk',key.encryption.private,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const pub=await crypto.subtle.importKey('spki',unb64(peer.publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:pub},priv,256);
 const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:unb64(e.salt),info:enc.encode(JSON.stringify(['elsewhen-private-v1',e.origin,e.type,e.sender.owner,e.recipient.owner]))},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function validateEncrypted(e,origin,from,to,type){
 try{if(!e||Object.keys(e).some(k=>!['version','type','origin','sender','recipient','salt','iv','ciphertext','signature'].includes(k))||e?.version!==1||e.origin!==origin||e.type!==type||!await verifyAdvertisement(e.sender,from)||!await verifyAdvertisement(e.recipient,to)||typeof e.salt!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(e.salt)||typeof e.iv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(e.iv)||typeof e.ciphertext!=='string'||e.ciphertext.length<22||e.ciphertext.length>3500||!/^[A-Za-z0-9_-]+$/.test(e.ciphertext)||typeof e.signature!=='string'||e.signature.length>128)return false;
 const pub=await crypto.subtle.importKey('spki',unb64(e.sender.signingKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,unb64(e.signature),enc.encode(JSON.stringify(signedFields(e))));}catch{return false}
}
export async function encryptPrivate(key,recipient,type,data,origin){
 const sender=await ensureEncryptionKey(key);if(!await verifyAdvertisement(recipient,recipient?.owner))throw Error('Recipient has no verified encryption key. They must enter with an updated client first.');
 const plaintext=enc.encode(JSON.stringify(data));if(plaintext.length>2500)throw Error('Encrypted content exceeds 2500 UTF-8 bytes');
 const e={version:1,type,origin,sender,recipient,salt:b64(crypto.getRandomValues(new Uint8Array(32))),iv:b64(crypto.getRandomValues(new Uint8Array(12)))};
 const aes=await aesKey(key,recipient,e);e.ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:unb64(e.iv),additionalData:enc.encode(JSON.stringify(header(e))),tagLength:128},aes,plaintext));e.signature=await sign(key,signedFields(e));return e;
}
export async function decryptPrivate(key,e,origin){
 const me=await keyId(key.public);if(!key.encryption)throw Error('Restore your key file with its encryption key');
 if(!await validateEncrypted(e,origin,e.sender?.owner,e.recipient?.owner,e.type))throw Error('Encrypted signature could not be verified');
 let peer;if(me===e.sender.owner){if(key.encryption.publicKey!==e.sender.publicKey)throw Error('This encrypted item needs an earlier key backup');peer=e.recipient}else if(me===e.recipient.owner){if(key.encryption.publicKey!==e.recipient.publicKey)throw Error('This encrypted item needs an earlier key backup');peer=e.sender}else throw Error('This item belongs to other keys');
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(e.iv),additionalData:enc.encode(JSON.stringify(header(e))),tagLength:128},await aesKey(key,peer,e),unb64(e.ciphertext));return JSON.parse(dec.decode(plaintext));
}
