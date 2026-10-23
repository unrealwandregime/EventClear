import { createPublicKey } from 'node:crypto';
import { getAddress, keccak256, recoverAddress, toHex } from 'viem';
import { aws, isMain } from './common.mjs';
export function addressFromSpki(base64) {
 const key=createPublicKey({key:Buffer.from(base64,'base64'),format:'der',type:'spki'});
 const jwk=key.export({format:'jwk'});
 if(jwk.kty!=='EC'||jwk.crv!=='secp256k1') throw Error('KMS_KEY_NOT_SECP256K1');
 const raw=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 return getAddress(`0x${keccak256(toHex(raw)).slice(-40)}`);
}
export function decodeDer(bytes) {
 let p=0;
 function length(){let n=bytes[p++];if(n&128){const count=n&127;if(count>2)throw Error('DER_LENGTH');n=0;for(let i=0;i<count;i++)n=n*256+bytes[p++];}return n;}
 if(bytes[p++]!==48)throw Error('DER_SEQUENCE');const end=length()+p;
 const read=()=>{if(bytes[p++]!==2)throw Error('DER_INTEGER');const n=length();const b=bytes.subarray(p,p+n);p+=n;if(!n||b[0]&128||n>33)throw Error('DER_RANGE');return BigInt(`0x${b.toString('hex')}`);};
 const r=read(),s=read();if(p!==end||p!==bytes.length)throw Error('DER_TRAILING');return {r,s};
}
export async function derive(keyId, runner=aws) {
 const meta=runner(['kms','get-public-key','--key-id',keyId]);
 if(meta.KeySpec!=='ECC_SECG_P256K1'||meta.KeyUsage!=='SIGN_VERIFY')throw Error('KMS_SIGNING_KEY_REQUIRED');
 const address=addressFromSpki(meta.PublicKey);
 const digest=keccak256(toHex('EventClear staging KMS address verification v1'));
 const signed=runner(['kms','sign','--key-id',keyId,'--message',Buffer.from(digest.slice(2),'hex').toString('base64'),'--message-type','DIGEST','--signing-algorithm','ECDSA_SHA_256']);
 let {r,s}=decodeDer(Buffer.from(signed.Signature,'base64'));
 const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
 if(r<=0n||r>=order||s<=0n||s>=order)throw Error('KMS_SIGNATURE_RANGE');
 if(s>order/2n)s=order-s;
 for(const v of [27,28]){
  const signature=`0x${r.toString(16).padStart(64,'0')}${s.toString(16).padStart(64,'0')}${v.toString(16)}`;
  if(await recoverAddress({hash:digest,signature})===address)return address;
 }
 throw Error('KMS_RECOVERY_MISMATCH');
}
if(isMain(import.meta.url)) { if(!process.argv[2])throw Error('KMS_KEY_ID_REQUIRED');console.log(await derive(process.argv[2])); }
