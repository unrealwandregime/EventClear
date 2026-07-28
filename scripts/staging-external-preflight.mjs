import { existsSync, readFileSync } from "node:fs";

const required = [
  "AWS_ROLE_ARN",
  "AWS_REGION",
  "AWS_ACCOUNT_ID",
  "STAGING_STACK_NAME",
  "STAGING_CHAIN_ID",
  "STAGING_RPC_PRIMARY",
  "STAGING_RPC_FALLBACK",
  "STAGING_ADMIN_ADDRESS",
  "STAGING_LP_ADDRESS",
  "STAGING_TEST_EOA",
  "RISK_SIGNER_KMS_KEY_ID",
  "RISK_SIGNER_ADDRESS",
  "STAGING_ALERT_TOPIC_ARN",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`STAGING_PREFLIGHT_MISSING:${missing.join(",")}`);

const chainId = Number(process.env.STAGING_CHAIN_ID);
if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId === 137) {
  throw new Error("STAGING_CHAIN_ID_INVALID_OR_MAINNET");
}
const rpcUrls = [process.env.STAGING_RPC_PRIMARY, process.env.STAGING_RPC_FALLBACK];
if (new Set(rpcUrls).size !== 2) throw new Error("STAGING_RPC_ENDPOINTS_MUST_BE_DISTINCT");
for (const raw of rpcUrls) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname.endsWith(".invalid")) {
    throw new Error("STAGING_RPC_MUST_BE_REAL_HTTPS");
  }
}
if (!existsSync("config/contracts/staging.json")) {
  if (process.env.STAGING_PREFLIGHT_PHASE !== "before-contracts") {
    throw new Error("STAGING_MANIFEST_MISSING");
  }
} else {
  const manifest = JSON.parse(readFileSync("config/contracts/staging.json", "utf8"));
  if (manifest.environment !== "staging" || manifest.chainId !== chainId) {
    throw new Error("STAGING_MANIFEST_ENVIRONMENT_OR_CHAIN_MISMATCH");
  }
}
if (process.env.ENABLE_MAINNET_EXECUTION === "true") {
  throw new Error("MAINNET_EXECUTION_PROHIBITED");
}
console.log("External staging preflight passed; no secret values were printed.");
