import {execFileSync} from "node:child_process";
import {writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
if(execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim())throw Error("CLEAN_CHECKOUT_REQUIRED");
await import("./restore-evidence.mjs");
const id=process.env.EVIDENCE_RUN_ID;
const branch=`codex/prototype-evidence-${id}`;
execFileSync("git",["checkout","-b",branch],{stdio:"inherit"});
execFileSync("git",["add","config/contracts/testnet-prototype.json","config/staging/deployed.json","docs/TESTNET_PROTOTYPE_DEPLOYMENT.md"],{stdio:"inherit"});
execFileSync("git",["commit","-m",`Record verified testnet-only prototype deployment from run ${id}`],{stdio:"inherit"});
execFileSync("git",["push","-u","origin",branch],{stdio:"inherit"});
const temp=mkdtempSync(join(tmpdir(),"prototype-pr-"));
try {
 const body=join(temp,"body.md");writeFileSync(body,`Promotes hash-verified public testnet deployment metadata from trusted workflow run ${id}. Review contract addresses, bytecode, roles, signer and caps before merge. This does not claim remote lifecycle acceptance. No secrets or raw broadcast/cache are included.\n`);
 execFileSync("gh",["pr","create","--repo","unrealwandregime/EventClear","--base","master","--head",branch,"--title","Record verified testnet prototype deployment","--body-file",body],{stdio:"inherit"});
}finally{rmSync(temp,{recursive:true,force:true})}
