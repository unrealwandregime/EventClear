// Audit registries describe published versions, not pnpm's locally patched source.
// Accept this advisory only after checking exact patch/source hashes and executing
// its regression against the actual ESLint dependency. No version-wide ignore.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
export function verifyBracesMitigation(){
 const metadata=JSON.parse(readFileSync('config/security/braces-mitigation.json','utf8'));
 if(metadata.advisoryId!=='GHSA-vfj7-8cjw-p6xm'||metadata.expires<new Date().toISOString().slice(0,10))throw Error('BRACES_MITIGATION_REVIEW_REQUIRED');
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 assert.equal(hash('patches/braces@3.0.3.patch'),metadata.patchSha256,'braces patch changed: review required');
 let require=createRequire(realpathSync('node_modules/eslint-config-next/package.json'));
 for(const name of ['@next/eslint-plugin-next','fast-glob','micromatch'])require=createRequire(require.resolve(name));
 const entry=require.resolve('braces'),parser=join(dirname(entry),'lib/parse.js');
 assert.equal(hash(parser),metadata.parserSha256,'unpatched braces parser reached by ESLint');
 const braces=require('braces');
 assert.deepEqual(braces.expand('src/{api,solver}/*.py'),['src/api/*.py','src/solver/*.py']);
 for(const depth of [64,1000,4096]){
  const pattern='{'.repeat(depth)+'a,b'+'}'.repeat(depth);
  for(const operation of ['parse','compile','expand'])assert.throws(()=>braces[operation](pattern),error=>error instanceof SyntaxError&&error.message==='BRACES_AST_DEPTH_LIMIT');
 }
 return metadata.advisoryId;
}
