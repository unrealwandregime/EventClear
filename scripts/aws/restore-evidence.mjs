import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { requireEnv } from './common.mjs';
requireEnv(['EVIDENCE_RUN_ID','STAGING_ACTION']);
if(!/^\d+$/.test(process.env.EVIDENCE_RUN_ID))throw Error('EVIDENCE_RUN_ID_REQUIRED');
const repo='unrealwandregime/EventClear';
const run=JSON.parse(execFileSync('gh',['api',`repos/${repo}/actions/runs/${process.env.EVIDENCE_RUN_ID}`],{encoding:'utf8'}));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(run.conclusion!=='success'||run.path!=='.github/workflows/staging-deploy.yml'||run.head_repository?.full_name!==repo)throw Error('UNTRUSTED_EVIDENCE_RUN');
// Contract evidence must match this exact build, preventing stale manifest/image drift.
if(process.env.STAGING_ACTION!=='rollback-services'&&run.head_sha!==head)throw Error('EVIDENCE_COMMIT_MISMATCH');
const action=process.env.STAGING_ACTION==='rollback-services'?'deploy-services':'deploy-contracts';
execFileSync('gh',['run','download',process.env.EVIDENCE_RUN_ID,'--repo',repo,'--pattern',`staging-evidence-${action}-*`,'--dir','.'],{stdio:'inherit'});
const file=process.env.STAGING_ACTION==='rollback-services'?'outputs/staging/previous-task-definitions.json':'config/contracts/staging.json';
if(!existsSync(file))throw Error('EVIDENCE_FILE_MISSING');
if(action==='deploy-contracts'){
 const evidence=JSON.parse(readFileSync('outputs/staging/contracts.json','utf8'));
 const manifest=JSON.parse(readFileSync(file,'utf8'));
 if(evidence.gitSha!==head||evidence.manifestHash!==manifest.manifestHash)throw Error('EVIDENCE_HASH_MISMATCH');
}
