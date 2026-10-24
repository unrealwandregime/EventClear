import test from "node:test";
import assert from "node:assert/strict";
import {generatePrivateKey,privateKeyToAccount} from "viem/accounts";
import {actors,assertPrototype} from "../../scripts/prototype/environment.mjs";
import {redeploy} from "../../scripts/prototype/host.mjs";
const environment=()=>({EVENTCLEAR_MODE:"testnet-prototype",CHAIN_ID:"80002",TESTNET_ASSETS_ONLY:"true",ENABLE_MAINNET_EXECUTION:"false",PUBLIC_CAPITAL_ACTIVATED:"false",PROTOTYPE_MAX_MONTHLY_COST_USD:"0",PROTOTYPE_ADMIN_ADDRESS:privateKeyToAccount(generatePrivateKey()).address,...Object.fromEntries(["PROTOTYPE_DEPLOYER_PRIVATE_KEY","PROTOTYPE_LP_PRIVATE_KEY","PROTOTYPE_TESTER_PRIVATE_KEY","RISK_SIGNER_PRIVATE_KEY"].map(k=>[k,generatePrivateKey()]))});
test("prototype actor pins derive and reject collision",()=>{
 const env=environment(); const result=actors(env);assert.equal(result.risk.address,env.RISK_SIGNER_ADDRESS);
 env.PROTOTYPE_LP_PRIVATE_KEY=env.PROTOTYPE_TESTER_PRIVATE_KEY;
 assert.throws(()=>actors(env),/ACTOR_PIN_MISMATCH|SEPARATE/);
});
test("prototype rejects capital, local chains and nonzero cost",()=>{
 for(const patch of [{CHAIN_ID:"137"},{CHAIN_ID:"31337"},{ENABLE_MAINNET_EXECUTION:"true"},{PUBLIC_CAPITAL_ACTIVATED:"true"},{PROTOTYPE_MAX_MONTHLY_COST_USD:"1"}]) assert.throws(()=>assertPrototype({...environment(),...patch}),/SAFETY_GATE/);
});
test("host adapter refuses paid existing service before redeploy", async()=>{
 const originalFetch=globalThis.fetch;
 const old={...process.env};let calls=0;
 try {
  Object.assign(process.env,{PROTOTYPE_MAX_MONTHLY_COST_USD:"0",RENDER_SERVICE_ID:"srv-example",RENDER_API_KEY:"test-only-not-a-real-credential"});
  globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.method,"GET");return new Response(JSON.stringify({type:"web_service",serviceDetails:{plan:"starter"}}))};
  await assert.rejects(()=>redeploy("a".repeat(40)),/VERIFIED_FREE_WEB_SERVICE_REQUIRED/);assert.equal(calls,1);
 }finally{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in old)) delete process.env[k];Object.assign(process.env,old)}
});
test("free-host redeploy pins and verifies the immutable commit",async()=>{
 const originalFetch=globalThis.fetch,old={...process.env},sha="b".repeat(40),calls=[];
 try {
  Object.assign(process.env,{PROTOTYPE_MAX_MONTHLY_COST_USD:"0",RENDER_SERVICE_ID:"srv-example",RENDER_API_KEY:"test-only-not-a-real-credential"});
  globalThis.fetch=async(url,options)=>{
   calls.push({url,options});
   return new Response(JSON.stringify(calls.length===1?{type:"web_service",serviceDetails:{plan:"free"}}:calls.length===2?{id:"dep-test"}:{status:"live",commit:{id:sha}}));
  };
  assert.equal((await redeploy(sha)).gitSha,sha);
  assert.deepEqual(JSON.parse(calls[1].options.body),{clearCache:"do_not_clear",commitId:sha});
  assert.equal(calls.filter(c=>c.options.method==="POST").length,1);
 }finally{globalThis.fetch=originalFetch;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)}
});
