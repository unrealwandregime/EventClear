import { readFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { assertStaging, requireEnv, isMain } from './common.mjs';
export function rpcUrls(env=process.env){
 requireEnv(['STAGING_RPC_PRIMARY','STAGING_RPC_FALLBACK'],env);
 const urls=[env.STAGING_RPC_PRIMARY,env.STAGING_RPC_FALLBACK];
 for(const x of urls){const u=new URL(x);if(u.protocol!=='https:'||u.username||u.password||u.hostname.endsWith('.invalid'))throw Error('RPC_HTTPS_REQUIRED');}
 if(new Set(urls).size!==2)throw Error('DISTINCT_RPC_URLS_REQUIRED');return urls;
}
export async function validateChain(env=process.env, addresses=[]) {
 const chainId=assertStaging(env);
 const registry=JSON.parse(readFileSync('config/staging/networks.json','utf8'));
 const network=registry[String(chainId)];if(!network)throw Error('UNREVIEWED_TEST_NETWORK');
 const information=await fetch(network.officialInformation,{signal:AbortSignal.timeout(20000)});
 if(!information.ok||!(await information.text()).includes(network.requiredText))throw Error('OFFICIAL_TESTNET_INFORMATION_UNVERIFIED');
 const clients=rpcUrls(env).map(u=>createPublicClient({transport:http(u,{retryCount:1,timeout:15000})}));
 if(!(await Promise.all(clients.map(c=>c.getChainId()))).every(id=>id===chainId))throw Error('RPC_CHAIN_MISMATCH');
 const heads=await Promise.all(clients.map(c=>c.getBlockNumber()));
 const blockNumber=heads.reduce((a,b)=>a<b?a:b);
 const blocks=await Promise.all(clients.map(c=>c.getBlock({blockNumber})));
 if(blocks[0].hash!==blocks[1].hash)throw Error('RPC_BLOCK_DISAGREEMENT');
 for(const address of addresses){const code=await Promise.all(clients.map(c=>c.getCode({address,blockNumber})));if(!code[0]||code[0]==='0x'||code[0]!==code[1])throw Error('RPC_CODE_DISAGREEMENT');}
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){await new Promise(r=>setTimeout(r,3000));if((await Promise.all(clients.map(c=>c.getBlockNumber()))).every(h=>h>blockNumber))return {chainId,blockNumber:String(blockNumber),blockHash:blocks[0].hash,codeVerified:addresses.length};}
 throw Error('REMOTE_CHAIN_NOT_ADVANCING');
}
if(isMain(import.meta.url))console.log(JSON.stringify(await validateChain()));
