import { readFileSync } from "node:fs";
import { createPublicClient,http } from "viem";
import { assertPrototype } from "./environment.mjs";
export async function validateChain(env=process.env,addresses=[]) {
 const chainId=assertPrototype(env);
 const urls=[env.RPC_PRIMARY,env.RPC_FALLBACK].filter(Boolean);
 if(!urls.length || urls.some(u=>{const x=new URL(u);return x.protocol!=="https:"||!!x.username||!!x.password}) || new Set(urls).size!==urls.length) throw Error("DISTINCT_HTTPS_RPC_REQUIRED");
 if(urls.length<2 && env.RPC_REDUNDANCY_DEGRADED!=="true") throw Error("RPC_REDUNDANCY_DEGRADED_ACK_REQUIRED");
 const network=JSON.parse(readFileSync("config/staging/networks.json","utf8"))[chainId];
 const info=await fetch(network.officialInformation,{signal:AbortSignal.timeout(20000)});
 if(!info.ok || !(await info.text()).includes(network.requiredText)) throw Error("OFFICIAL_CHAIN_INFORMATION_UNVERIFIED");
 const clients=urls.map(url=>createPublicClient({transport:http(url,{retryCount:1,timeout:15000})}));
 if(!(await Promise.all(clients.map(c=>c.getChainId()))).every(id=>id===chainId)) throw Error("RPC_CHAIN_MISMATCH");
 const heads=await Promise.all(clients.map(c=>c.getBlockNumber()));
 const blockNumber=heads.reduce((a,b)=>a<b?a:b);
 if(heads.some(h=>h-blockNumber>20n)) throw Error("RPC_HEADS_INCONSISTENT");
 const blocks=await Promise.all(clients.map(c=>c.getBlock({blockNumber})));
 if(blocks.some(b=>b.hash!==blocks[0].hash)) throw Error("RPC_STATE_DISAGREEMENT");
 for(const address of addresses) {
   const codes=await Promise.all(clients.map(c=>c.getCode({address,blockNumber})));
   if(!codes[0]||codes[0]==="0x"||codes.some(c=>c!==codes[0])) throw Error("RPC_CODE_DISAGREEMENT");
 }
 for(let attempt=0;attempt<30;attempt++) {
  await new Promise(r=>setTimeout(r,3000));
  if((await Promise.all(clients.map(c=>c.getBlockNumber()))).every(h=>h>blockNumber)) return {chainId,blockNumber:String(blockNumber),rpcRedundancy:urls.length>1?"verified":"RPC_REDUNDANCY_DEGRADED"};
 }
 throw Error("CHAIN_NOT_ADVANCING");
}
