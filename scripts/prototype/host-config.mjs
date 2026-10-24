// Writes public metadata only. Never include RPC, DB, Redis or wallet credentials.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { manifest } from "./environment.mjs";
const m = manifest(),
  fixture = JSON.parse(readFileSync("config/staging/deployed.json", "utf8"));
const e = JSON.parse(readFileSync("outputs/prototype/contracts.json", "utf8"));
if (e.manifestHash !== m.manifestHash || !e.receipts?.length)
  throw Error("DEPLOYMENT_EVIDENCE_REQUIRED");
const host = {
  PROTOTYPE_MANIFEST_JSON: JSON.stringify(m),
  PROTOTYPE_FIXTURE_JSON: JSON.stringify(fixture),
  PROTOTYPE_DEPLOYER_ADDRESS: e.actors.deployer,
  PROTOTYPE_LP_ADDRESS: e.actors.lp,
  PROTOTYPE_TESTER_ADDRESS: e.actors.tester,
  PROTOTYPE_ADMIN_ADDRESS: e.administrator,
  RISK_SIGNER_ADDRESS: e.riskSigner,
  INDEXER_START_BLOCK: String(
    e.receipts.reduce(
      (min, r) => (BigInt(r.blockNumber) < min ? BigInt(r.blockNumber) : min),
      BigInt(e.receipts[0].blockNumber),
    ),
  ),
};
mkdirSync("outputs/prototype", { recursive: true });
writeFileSync(
  "outputs/prototype/host-public-config.json",
  JSON.stringify(host, null, 2) + "\n",
);
console.log(
  "Public host configuration written; secret bindings must stay in provider storage.",
);
