import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, http, parseAbi, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertStaging, requireEnv, isMain, canonical } from './common.mjs';
import { validateSigners } from './validate-test-signers.mjs';
import { validateChain } from './validate-chain.mjs';
import { readOutputs } from './read-staging-outputs.mjs';
import { derive } from './derive-kms-ethereum-address.mjs';
export const limits={STAGING_DEPOSIT_CAP:'1000000000',STAGING_PER_BUNDLE_CAP:'100000000',STAGING_UTILIZATION_CAP_BPS:'5000',STAGING_MINIMUM_RESERVE_BPS:'2000',STAGING_MAXIMUM_DURATION:'2592000',STAGING_MAXIMUM_ADVANCE:'100000000',STAGING_PER_WALLET_EXPOSURE:'200000000',STAGING_PER_MARKET_EXPOSURE:'300000000',STAGING_PER_RELATIONSHIP_EXPOSURE:'300000000',STAGING_GLOBAL_EXPOSURE:'500000000'};
export function deriveActors(env=process.env){
 requireEnv(['STAGING_DEPLOYER_PRIVATE_KEY','STAGING_LP_PRIVATE_KEY','STAGING_TEST_EOA_PRIVATE_KEY','STAGING_ADMIN_ADDRESS'],env);
 for(const [key,address] of [['STAGING_DEPLOYER_PRIVATE_KEY','STAGING_DEPLOYER_ADDRESS'],['STAGING_LP_PRIVATE_KEY','STAGING_LP_ADDRESS'],['STAGING_TEST_EOA_PRIVATE_KEY','STAGING_TEST_EOA']]){
  const derived=privateKeyToAccount(env[key]).address;
  if(env[address]&&env[address].toLowerCase()!==derived.toLowerCase())throw Error('ACTOR_PIN_MISMATCH');env[address]=derived;
 }
 const actors=validateSigners(env);
 if(Object.values(actors).some(a=>a.address.toLowerCase()===env.STAGING_ADMIN_ADDRESS.toLowerCase()))throw Error('SEPARATE_ADMIN_REQUIRED');
 return actors;
}
export async function verifyDeployment(manifest,env=process.env){
 const {manifestHash,...manifestPayload}=manifest;
 if(!manifestHash||manifestHash!=='0x'+createHash('sha256').update(canonical(manifestPayload)).digest('hex'))throw Error('STAGING_MANIFEST_HASH_MISMATCH');
 const chainId=assertStaging(env),client=createPublicClient({transport:http(env.STAGING_RPC_PRIMARY)});
 if(manifest.chainId!==chainId||manifest.environment!=='staging'||await client.getChainId()!==chainId)throw Error('DEPLOYMENT_CHAIN_MISMATCH');
 const call=async(key,signature,args=[])=>client.readContract({address:manifest.contracts[key].address,abi:parseAbi([signature]),functionName:signature.match(/function (\w+)/)[1],args});
 for(const key of ['relationshipRegistry','claims','treasury','fundingPool','riskPolicy','vault']){
  for(const [who,expected] of [[env.STAGING_ADMIN_ADDRESS,true],[env.STAGING_DEPLOYER_ADDRESS,false]]){
   if(await call(key,'function hasRole(bytes32,address) view returns (bool)',['0x'+'00'.repeat(32),who])!==expected)throw Error(`ADMIN_ROLE_MISMATCH:${key}`);
  }
 }
 for(const [key,name,address] of [['fundingPool','LP_ROLE',env.STAGING_LP_ADDRESS],['claims','VAULT_ROLE',manifest.contracts.vault.address],['riskPolicy','VAULT_ROLE',manifest.contracts.vault.address]]){
  if(!await call(key,'function hasRole(bytes32,address) view returns (bool)',[keccak256(toHex(name)),address]))throw Error(`REQUIRED_ROLE_MISSING:${key}`);
 }
 const signer=await call('riskPolicy','function quoteSigner() view returns (address)');if(signer.toLowerCase()!==env.RISK_SIGNER_ADDRESS.toLowerCase())throw Error('RISK_SIGNER_MISMATCH');
 for(const [fn,name] of [['depositCap','STAGING_DEPOSIT_CAP'],['perBundleCap','STAGING_PER_BUNDLE_CAP'],['utilizationCapBps','STAGING_UTILIZATION_CAP_BPS'],['minimumReserveBps','STAGING_MINIMUM_RESERVE_BPS']]){
  if(await call('fundingPool',`function ${fn}() view returns (uint256)`)!==BigInt(limits[name]))throw Error(`POOL_LIMIT_MISMATCH:${fn}`);
 }
 for(const [key,role] of [['relationshipRegistry','REVIEWER_ROLE'],['relationshipRegistry','SUSPENDER_ROLE'],['riskPolicy','RISK_ADMIN_ROLE'],['vault','PAUSER_ROLE']]){
  const id=keccak256(toHex(role));
  if(!await call(key,'function hasRole(bytes32,address) view returns (bool)',[id,env.STAGING_ADMIN_ADDRESS])||await call(key,'function hasRole(bytes32,address) view returns (bool)',[id,env.STAGING_DEPLOYER_ADDRESS]))throw Error('CONTROL_ROLE_MISMATCH');
 }
 for(const [fn,name] of [['maximumBundleDuration','STAGING_MAXIMUM_DURATION'],['maximumGrossAdvance','STAGING_MAXIMUM_ADVANCE'],['perWalletExposureCap','STAGING_PER_WALLET_EXPOSURE'],['perMarketExposureCap','STAGING_PER_MARKET_EXPOSURE'],['perRelationshipExposureCap','STAGING_PER_RELATIONSHIP_EXPOSURE'],['globalExposureCap','STAGING_GLOBAL_EXPOSURE']])if(await call('riskPolicy',`function ${fn}() view returns (uint256)`)!==BigInt(limits[name]))throw Error('RISK_LIMIT_MISMATCH');
 if(!await call('riskPolicy','function allowedAdapters(address) view returns (bool)',[manifest.contracts.standardAdapter.address])||!await call('riskPolicy','function allowedCollaterals(address) view returns (bool)',[manifest.contracts.collateralToken.address]))throw Error('RISK_ALLOWLIST_MISMATCH');
 if(env.STAGING_RELATIONSHIP_HASH){
  if(!await call('relationshipRegistry','function isActive(bytes32) view returns (bool)',[env.STAGING_RELATIONSHIP_HASH]))throw Error('RELATIONSHIP_NOT_ACTIVE');
  if(await call('relationshipRegistry','function versionOf(bytes32) view returns (uint32)',[env.STAGING_RELATIONSHIP_HASH])!==1)throw Error('RELATIONSHIP_VERSION_MISMATCH');
 }
 for(const [getter,key] of [['collateral','collateralToken'],['positions','conditionalTokens'],['registry','relationshipRegistry'],['claims','claims'],['fundingPool','fundingPool'],['adapter','standardAdapter'],['riskPolicy','riskPolicy']]){
  if((await call('vault',`function ${getter}() view returns (address)`)).toLowerCase()!==manifest.contracts[key].address.toLowerCase())throw Error('VAULT_CONSTRUCTOR_STATE_MISMATCH');
 }
 return {chainId,roles:'verified',signer:'verified',poolLimits:'verified',riskLimits:'verified',constructors:'verified'};
}
export async function deploy(){
 assertStaging();const o=readOutputs(),actors=deriveActors();await validateChain();
 process.env.RISK_SIGNER_ADDRESS=await derive(o.RiskKeyArn);process.env.STAGING_RPC_URL=process.env.STAGING_RPC_PRIMARY;
 const client=createPublicClient({transport:http(process.env.STAGING_RPC_PRIMARY)});
 if(await client.getBalance({address:actors.deployer.address})===0n)throw Error('DEPLOYER_TESTNET_GAS_REQUIRED');
 execFileSync('python',['scripts/aws/generate-staging-fixture.py'],{stdio:'inherit'});
 const fixture=JSON.parse(readFileSync('config/staging/deployed.json','utf8')),r=fixture.relationship;
 Object.assign(process.env,limits,{STAGING_RELATIONSHIP_HASH:r.canonicalDefinitionHash,STAGING_RULES_HASH:r.resolutionRulesHash,STAGING_EARLIEST_RESOLUTION:String(r.earliestResolutionTimestamp),STAGING_LATEST_RESOLUTION:String(r.latestResolutionTimestamp),ENABLE_MAINNET_EXECUTION:'false'});
 try {execFileSync('forge',['script','script/DeployStaging.s.sol:DeployStaging','--rpc-url',process.env.STAGING_RPC_PRIMARY,'--broadcast'],{cwd:'packages/contracts',env:process.env,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});}catch{throw Error('STAGING_CONTRACT_BROADCAST_FAILED_INSPECT_PROTECTED_RUNNER');}
 execFileSync('pnpm',['deployment:record-staging'],{stdio:'inherit'});
 const manifest=JSON.parse(readFileSync('config/contracts/staging.json','utf8'));
 const verification=await verifyDeployment(manifest);
 await validateChain(process.env,Object.values(manifest.contracts).map(c=>c.address));
 mkdirSync('outputs/staging',{recursive:true});
 const broadcast=JSON.parse(readFileSync(`packages/contracts/broadcast/DeployStaging.s.sol/${manifest.chainId}/run-latest.json`));
 // Never upload raw Foundry cache/broadcast files: they may include sensitive metadata.
 writeFileSync('outputs/staging/contracts.json',JSON.stringify({gitSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),at:new Date().toISOString(),manifestHash:manifest.manifestHash,chainId:manifest.chainId,verification,actors:Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,a.address])),administrator:process.env.STAGING_ADMIN_ADDRESS,kmsSigner:process.env.RISK_SIGNER_ADDRESS,transactions:broadcast.transactions.map(t=>({hash:t.hash,contractName:t.contractName,contractAddress:t.contractAddress})),receipts:(broadcast.receipts??[]).map(r=>({transactionHash:r.transactionHash,blockNumber:r.blockNumber,status:r.status}))},null,2));
}
if(isMain(import.meta.url))await deploy();
