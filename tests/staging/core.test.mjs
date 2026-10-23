import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, createECDH } from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { assertStaging } from '../../scripts/aws/common.mjs';
import { addressFromSpki, derive } from '../../scripts/aws/derive-kms-ethereum-address.mjs';
import { validateSigners } from '../../scripts/aws/validate-test-signers.mjs';
import { provisionParameters, taskDefinition } from '../../scripts/aws/operate.mjs';
import { cookie, authorized, gateway } from '../../scripts/aws/staging-gateway.mjs';
import { validateOutputs, requiredOutputs } from '../../scripts/aws/read-staging-outputs.mjs';
import { rpcUrls } from '../../scripts/aws/validate-chain.mjs';
import { createServer } from 'node:http';
const base={STAGING_CHAIN_ID:'11155111',STAGING_TEST_ASSETS_ONLY:'true'};
const actorEnv=()=>{const e={...base};for(const [k,a] of [['STAGING_DEPLOYER_PRIVATE_KEY','STAGING_DEPLOYER_ADDRESS'],['STAGING_LP_PRIVATE_KEY','STAGING_LP_ADDRESS'],['STAGING_TEST_EOA_PRIVATE_KEY','STAGING_TEST_EOA']]){e[k]=generatePrivateKey();e[a]=privateKeyToAccount(e[k]).address;}return e;};
test('mainnet, local chain, activation and absent attestations fail closed',()=>{
 for(const id of ['1','137','31337','1337','0','NaN'])assert.throws(()=>assertStaging({...base,STAGING_CHAIN_ID:id}));
 assert.throws(()=>assertStaging({...base,ENABLE_MAINNET_EXECUTION:'true'}));assert.throws(()=>assertStaging({...base,STAGING_TEST_ASSETS_ONLY:undefined}));
 assert.equal(assertStaging(base),11155111);
});
test('dedicated actors reject Anvil keys, mismatched pins, and duplicate identities',()=>{
 const e=actorEnv();assert.equal(Object.keys(validateSigners(e)).length,3);
 assert.throws(()=>validateSigners({...e,STAGING_LP_ADDRESS:e.STAGING_TEST_EOA}));
 assert.throws(()=>validateSigners({...e,STAGING_LP_PRIVATE_KEY:e.STAGING_TEST_EOA_PRIVATE_KEY,STAGING_LP_ADDRESS:e.STAGING_TEST_EOA}));
 const dev='0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
 assert.throws(()=>validateSigners({...e,STAGING_DEPLOYER_PRIVATE_KEY:dev,STAGING_DEPLOYER_ADDRESS:privateKeyToAccount(dev).address}),/DEVELOPMENT_KEY/);
});
test('KMS SPKI derives and verifies the Ethereum address from a real recoverable signature',async()=>{
 const key=generatePrivateKey(),a=privateKeyToAccount(key),ecdh=createECDH('secp256k1');ecdh.setPrivateKey(Buffer.from(key.slice(2),'hex'));const pub=ecdh.getPublicKey();
 const spki=createPublicKey({key:{kty:'EC',crv:'secp256k1',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')},format:'jwk'}).export({type:'spki',format:'der'}).toString('base64');
 assert.equal(addressFromSpki(spki),a.address);
 const derInt=hex=>{let b=Buffer.from(hex,'hex');while(b.length>1&&b[0]===0)b=b.subarray(1);if(b[0]&128)b=Buffer.concat([Buffer.from([0]),b]);return Buffer.concat([Buffer.from([2,b.length]),b]);};
 // Build the signature first using the same digest, then emulate the KMS boundary.
 const {keccak256,toHex}=await import('viem');const sig=await a.sign({hash:keccak256(toHex('EventClear staging KMS address verification v1'))});
 const body=Buffer.concat([derInt(sig.slice(2,66)),derInt(sig.slice(66,130))]);const der=Buffer.concat([Buffer.from([48,body.length]),body]).toString('base64');
 const runner=args=>args[1]==='get-public-key'?{PublicKey:spki,KeySpec:'ECC_SECG_P256K1',KeyUsage:'SIGN_VERIFY'}:{Signature:der};
 assert.equal(await derive('test-key',runner),a.address);
 await assert.rejects(()=>derive('test-key',()=>({PublicKey:spki,KeySpec:'RSA_2048',KeyUsage:'SIGN_VERIFY'})));
});
test('provision requires explicit cost switch and operator budget',()=>{
 const e={STAGING_DOMAIN:'staging.example.com',STAGING_HOSTED_ZONE_ID:'Z123',STAGING_ALERT_EMAIL:'operator@example.com',STAGING_BUDGET_USD:'42'};
 assert.throws(()=>provisionParameters(e));assert.equal(provisionParameters({...e,ALLOW_AWS_PROVISION:'true'}).BudgetUsd,'42');assert.throws(()=>provisionParameters({...e,ALLOW_AWS_PROVISION:'true',STAGING_BUDGET_USD:'0'}));
});
test('stack output validation rejects missing outputs and unfinished stacks',()=>{
 assert.throws(()=>validateOutputs({StackStatus:'CREATE_IN_PROGRESS'}));
 const Outputs=requiredOutputs.map(k=>({OutputKey:k,OutputValue:['WebUrl','ApiUrl'].includes(k)?'https://staging.example.com':'test'}));assert.equal(validateOutputs({StackStatus:'CREATE_COMPLETE',Outputs}).WebUrl,'https://staging.example.com');
 assert.throws(()=>validateOutputs({StackStatus:'CREATE_COMPLETE',Outputs:Outputs.slice(1)}));
});
test('RPC endpoints require distinct HTTPS without embedded basic credentials',()=>{
 assert.throws(()=>rpcUrls({STAGING_RPC_PRIMARY:'http://a.example',STAGING_RPC_FALLBACK:'https://b.example'}));assert.throws(()=>rpcUrls({STAGING_RPC_PRIMARY:'https://a.example',STAGING_RPC_FALLBACK:'https://a.example'}));
});
test('staging access cookies reject tampering and expiry',()=>{
 const token='a'.repeat(48),now=Date.now();assert.ok(authorized(cookie(token,now+60000),token,now));assert.ok(!authorized(cookie(token,now-1),token,now));assert.ok(!authorized(cookie(token,now+60000),'b'.repeat(48),now));
});
test('access gateway enforces HTTPS, blocks anonymous requests and proxies access server-side',async()=>{
 const token='a'.repeat(48);let forwarded;
 const upstream=createServer((req,res)=>{forwarded=req.headers['x-staging-access'];res.setHeader('content-type','application/json');res.end('{"ok":true}');});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const server=gateway({token,apiUrl:`http://127.0.0.1:${upstream.address().port}`,webUrl:`http://127.0.0.1:${upstream.address().port}`});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url,{headers:{'x-forwarded-proto':'https'}})).status,403);
  const response=await fetch(url+'/api/v1/markets',{headers:{'x-forwarded-proto':'https','x-staging-access':token}});assert.equal(response.status,200);assert.equal(forwarded,token);assert.deepEqual(await response.json(),{ok:true});
  const login=await fetch(url+'/staging/access',{method:'POST',headers:{'x-forwarded-proto':'https'},body:new URLSearchParams({token}),redirect:'manual'});assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 }finally{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);}
});
test('CloudFormation keeps data stores private and OIDC scoped to the protected environment',async()=>{
 const {readFileSync}=await import('node:fs');const load=p=>JSON.parse(readFileSync(p,'utf8'));
 const b=load('infrastructure/aws/bootstrap/template.json');
 const trust=b.Resources.DeployRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
 assert.equal(trust['token.actions.githubusercontent.com:sub'],'repo:unrealwandregime/EventClear:environment:staging');
 assert.equal(trust['token.actions.githubusercontent.com:aud'],'sts.amazonaws.com');
 const s=load('infrastructure/aws/staging/template.json');assert.equal(s.Resources.Database.Properties.PubliclyAccessible,false);assert.equal(s.Resources.Redis.Properties.TransitEncryptionEnabled,true);assert.equal(s.Resources.Redis.Properties.AtRestEncryptionEnabled,true);
 for(const [name,res] of Object.entries(s.Resources))if(res.Type==='AWS::EC2::SecurityGroupIngress'&&[5432,6379,8001].includes(res.Properties.FromPort))assert.equal(res.Properties.CidrIp,undefined,name);
 assert.equal(s.Resources.Artifacts.Properties.VersioningConfiguration.Status,'Enabled');assert.equal(s.Resources.RiskKey.Properties.KeySpec,'ECC_SECG_P256K1');assert.equal(s.Resources.Budget.Properties.Budget.BudgetLimit.Amount.Ref,'BudgetUsd');
});
test('new ECS task definitions use immutable images and scoped secret injection without wallet keys',()=>{
 const contracts=Object.fromEntries(['vault','claims','fundingPool','collateralToken','standardAdapter','conditionalTokens','relationshipRegistry','treasury','riskPolicy'].map(k=>[k,{address:'0x'+'12'.repeat(20)}]));
 const o={WebUrl:'https://staging.example.com',RuntimeSecretArn:'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',ServiceNamespaceName:'eventclear.internal',ExecutionRoleArn:'execution',ApiTaskRoleArn:'api-role',ArtifactBucket:'private',RiskKeyArn:'kms'};
 const env={AWS_REGION:'us-east-1',STAGING_STACK_NAME:'eventclear-staging',RISK_SIGNER_ADDRESS:'0x'+'34'.repeat(20)};
 const definition=taskDefinition('api','repo:'+ 'a'.repeat(40),o,{chainId:11155111,contracts},{...env});
 assert.equal(definition.networkMode,'awsvpc');assert.equal(definition.containerDefinitions[0].environment.find(x=>x.name==='ENABLE_MAINNET_EXECUTION').value,'false');
 const serialized=JSON.stringify(definition);assert.ok(!serialized.includes('PRIVATE_KEY'));assert.ok(!definition.containerDefinitions[0].environment.some(x=>x.name==='DATABASE_URL'));assert.ok(definition.containerDefinitions[0].secrets.some(x=>x.name==='DATABASE_URL'));
 assert.throws(()=>taskDefinition('api','repo:latest',o,{chainId:11155111,contracts},env));
});
test('the exact installed braces mitigation rejects adversarial depth while preserving valid expansion',async()=>{
 const {verifyBracesMitigation}=await import('../../scripts/check-braces-mitigation.mjs');assert.equal(verifyBracesMitigation(),'GHSA-vfj7-8cjw-p6xm');
});
