import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assertStaging, aws } from "./aws/common.mjs";
import { readOutputs } from "./aws/read-staging-outputs.mjs";
import { deriveActors, verifyDeployment } from "./aws/deploy-contracts.mjs";
import { validateChain } from "./aws/validate-chain.mjs";
import { derive } from "./aws/derive-kms-ethereum-address.mjs";
const prototype = process.env.EVENTCLEAR_MODE === "testnet-prototype";
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const prototypeEnv = prototype
  ? await import("./prototype/environment.mjs")
  : null;
const actors = prototype ? prototypeEnv.stagingCompatibility() : deriveActors();
const manifest = load(
    prototype
      ? "config/contracts/testnet-prototype.json"
      : "config/contracts/staging.json",
  ),
  fixture = load("config/staging/deployed.json");
const chainId = assertStaging(),
  o = prototype
    ? { ApiUrl: process.env.PROTOTYPE_URL, WebUrl: process.env.PROTOTYPE_URL }
    : readOutputs();
if (prototype) {
  prototypeEnv.manifest();
  if (!o.ApiUrl?.startsWith("https://"))
    throw Error("PROTOTYPE_HTTPS_URL_REQUIRED");
} else process.env.RISK_SIGNER_ADDRESS = await derive(o.RiskKeyArn);
const checkChain = prototype
  ? (await import("./prototype/validate-chain.mjs")).validateChain
  : validateChain;
await checkChain(
  process.env,
  Object.values(manifest.contracts).map((c) => c.address),
);
process.env.STAGING_RELATIONSHIP_HASH =
  fixture.relationship.canonicalDefinitionHash;
await verifyDeployment(manifest);
const runtime = prototype
  ? { accessToken: process.env.STAGING_ACCESS_TOKEN }
  : JSON.parse(
      aws([
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        o.RuntimeSecretArn,
      ]).SecretString,
    );
const { redeploy } = await import("./prototype/host.mjs");
const runUi = async (phase) =>
  execFileSync(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.staging.config.ts",
      "--grep",
      `remote ${phase}`,
    ],
    { stdio: "inherit" },
  );
await (
  await import("./lifecycle/execute.mjs")
).executeLifecycle({
  prototype,
  chainId,
  o,
  actors,
  manifest,
  fixture,
  runtime,
  restartHost: redeploy,
  runUi,
});
