import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function aws(args, input) {
  try { return JSON.parse(execFileSync('aws', [...args, '--output', 'json', '--no-cli-pager'], { input: input && JSON.stringify(input), encoding: 'utf8', stdio: ['pipe','pipe','pipe'], maxBuffer: 16*1024*1024 })); }
  catch { throw new Error(`AWS_OPERATION_FAILED:${args.slice(0,2).join(':')}`); }
}
export function requireEnv(names, env=process.env) {
  const missing=names.filter(n=>!env[n]?.trim());
  if(missing.length) throw Error(`MISSING_INPUTS:${missing.join(',')}`);
  return Object.fromEntries(names.map(n=>[n,env[n]]));
}
export function assertStaging(env=process.env) {
  const id=Number(env.STAGING_CHAIN_ID);
  if(!Number.isSafeInteger(id)||id<=0||[1,137,31337,1337].includes(id)) throw Error('PERSISTENT_TEST_CHAIN_REQUIRED');
  if(env.ENABLE_MAINNET_EXECUTION==='true'||env.PUBLIC_CAPITAL_ACTIVATED==='true') throw Error('CAPITAL_ACTIVATION_PROHIBITED');
  if(env.STAGING_TEST_ASSETS_ONLY!=='true') throw Error('TEST_ASSETS_ATTESTATION_REQUIRED');
  return id;
}
export function isMain(url) { return process.argv[1] && url===pathToFileURL(process.argv[1]).href; }
export const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
