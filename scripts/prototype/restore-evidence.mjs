import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,mkdirSync,copyFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {canonical,assertPrototype} from "./environment.mjs";
assertPrototype();
const id=process.env.EVIDENCE_RUN_ID, repo="unrealwandregime/EventClear";
if(!/^\d+$/.test(id??"")) throw Error("EVIDENCE_RUN_REQUIRED");
const run=JSON.parse(execFileSync("gh",["api",`repos/${repo}/actions/runs/${id}`],{encoding:"utf8"}));
if(run.conclusion!=="success"||run.path!==".github/workflows/testnet-prototype.yml"||run.head_repository?.full_name!==repo) throw Error("UNTRUSTED_PROTOTYPE_EVIDENCE");
const directory=mkdtempSync(join(tmpdir(),"prototype-evidence-"));
try {
 execFileSync("gh",["run","download",id,"--repo",repo,"--name","prototype-contract-evidence","--dir",directory],{stdio:["ignore","pipe","pipe"]});
 const manifest=JSON.parse(readFileSync(join(directory,"config/contracts/testnet-prototype.json"),"utf8"));
 const evidence=JSON.parse(readFileSync(join(directory,"outputs/prototype/contracts.json"),"utf8"));
 const {manifestHash,...payload}=manifest;
 const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(evidence.gitSha!==sha||manifest.environment!=="testnet-prototype"||manifest.chainId!==Number(process.env.CHAIN_ID)||evidence.manifestHash!==manifestHash||manifestHash!=="0x"+createHash("sha256").update(canonical(payload)).digest("hex")) throw Error("PROTOTYPE_EVIDENCE_MISMATCH");
 for(const file of ["config/contracts/testnet-prototype.json","config/staging/deployed.json","outputs/prototype/contracts.json","docs/TESTNET_PROTOTYPE_DEPLOYMENT.md"]) {
  mkdirSync(dirname(file),{recursive:true});copyFileSync(join(directory,file),file);
 }
}finally{rmSync(directory,{recursive:true,force:true})}
