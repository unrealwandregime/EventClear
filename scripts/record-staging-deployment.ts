import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, keccak256 } from "viem";

const rpcUrl = process.env.STAGING_RPC_URL;
if (!rpcUrl) throw new Error("STAGING_RPC_URL_REQUIRED");
const chainId = Number(process.env.STAGING_CHAIN_ID ?? process.env.CHAIN_ID ?? "31337");
if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId === 137) {
  throw new Error("STAGING_CHAIN_ID_INVALID_OR_MAINNET");
}

const root = process.cwd();
const broadcastPath = resolve(
  root,
  "packages/contracts/broadcast/DeployStaging.s.sol",
  String(chainId),
  "run-latest.json",
);
const broadcast = JSON.parse(await readFile(broadcastPath, "utf8")) as {
  transactions: Array<{
    transactionType: string;
    contractName?: string;
    contractAddress?: string;
    hash?: string;
    arguments?: unknown[];
  }>;
};
const names: Record<string, string> = {
  MockPUSD: "collateralToken",
  MockConditionalTokens: "conditionalTokens",
  MockResolutionOracle: "resolutionOracle",
  MockCTFAdapter: "standardAdapter",
  RelationshipRegistry: "relationshipRegistry",
  RiskPolicy: "riskPolicy",
  EventClearClaims: "claims",
  EventClearTreasury: "treasury",
  EventClearFundingPool: "fundingPool",
  EventClearVault: "vault",
};
const deployments = broadcast.transactions.filter(
  (item) =>
    item.transactionType === "CREATE" &&
    item.contractName &&
    item.contractAddress &&
    names[item.contractName],
);
if (deployments.length !== Object.keys(names).length) {
  throw new Error("STAGING_DEPLOYMENT_INCOMPLETE");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== chainId) throw new Error("STAGING_RPC_CHAIN_MISMATCH");
const contracts: Record<string, { address: `0x${string}`; kind: string; notes: string }> = {};
const bytecodeHashes: Record<string, string> = {};
const constructorArguments: Record<string, unknown[]> = {};
const deploymentTransactions: Record<string, string> = {};
for (const deployment of deployments) {
  const address = getAddress(deployment.contractAddress!);
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`STAGING_BYTECODE_MISSING:${deployment.contractName}`);
  const key = names[deployment.contractName!];
  contracts[key] = {
    address,
    kind: deployment.contractName!,
    notes: `bytecode ${keccak256(code)}`,
  };
  bytecodeHashes[key] = keccak256(code);
  constructorArguments[key] = deployment.arguments ?? [];
  if (!deployment.hash) throw new Error(`STAGING_TRANSACTION_HASH_MISSING:${deployment.contractName}`);
  deploymentTransactions[key] = deployment.hash;
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const manifestBase = {
  environment: "staging",
  chainId,
  reviewedAt: new Date().toISOString(),
  registrySource: "https://github.com/unrealwandregime/EventClear",
  contracts,
};
const manifestHash = `0x${createHash("sha256").update(canonical(manifestBase)).digest("hex")}`;
await writeFile(
  resolve(root, "config/contracts/staging.json"),
  `${JSON.stringify({ ...manifestBase, manifestHash }, null, 2)}\n`,
);

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const requiredRecordValues = {
  administrator: process.env.STAGING_ADMIN_ADDRESS,
  riskSigner: process.env.RISK_SIGNER_ADDRESS,
  relationshipDefinitionHash: process.env.STAGING_RELATIONSHIP_HASH,
  ruleDocumentHash: process.env.STAGING_RULES_HASH,
  depositCap: process.env.STAGING_DEPOSIT_CAP,
  perBundleCap: process.env.STAGING_PER_BUNDLE_CAP,
  utilizationCapBps: process.env.STAGING_UTILIZATION_CAP_BPS,
  minimumReserveBps: process.env.STAGING_MINIMUM_RESERVE_BPS,
  maximumDuration: process.env.STAGING_MAXIMUM_DURATION,
  maximumAdvance: process.env.STAGING_MAXIMUM_ADVANCE,
  perWalletExposure: process.env.STAGING_PER_WALLET_EXPOSURE,
  perMarketExposure: process.env.STAGING_PER_MARKET_EXPOSURE,
  perRelationshipExposure: process.env.STAGING_PER_RELATIONSHIP_EXPOSURE,
  globalExposure: process.env.STAGING_GLOBAL_EXPOSURE,
};
const missingRecordValues = Object.entries(requiredRecordValues)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missingRecordValues.length > 0) {
  throw new Error(`STAGING_DEPLOYMENT_METADATA_MISSING:${missingRecordValues.join(",")}`);
}
const riskLimits = Object.fromEntries(
  Object.entries(requiredRecordValues).filter(([key]) =>
    [
      "depositCap",
      "perBundleCap",
      "utilizationCapBps",
      "minimumReserveBps",
      "maximumDuration",
      "maximumAdvance",
      "perWalletExposure",
      "perMarketExposure",
      "perRelationshipExposure",
      "globalExposure",
    ].includes(key),
  ),
);
const deploymentTimestamp = new Date().toISOString();
const evidence = {
  network: process.env.STAGING_NETWORK_NAME ?? "controlled-staging",
  chainId,
  gitCommit: commit,
  compiler: "Solidity 0.8.26",
  deploymentTimestamp,
  contracts,
  deploymentTransactions,
  constructorArguments,
  bytecodeHashes,
  manifestHash,
  administrator: requiredRecordValues.administrator,
  treasury: contracts.treasury.address,
  riskSigner: requiredRecordValues.riskSigner,
  riskLimits,
  relationshipDefinitionHash: requiredRecordValues.relationshipDefinitionHash,
  ruleDocumentHash: requiredRecordValues.ruleDocumentHash,
};
const evidenceHash = `0x${createHash("sha256").update(canonical(evidence)).digest("hex")}`;
const lines = [
  "# Staging deployment record",
  "",
  `- Deployment timestamp: ${deploymentTimestamp}`,
  `- Network: ${evidence.network}`,
  `- Chain ID: ${chainId}`,
  `- Git commit: \`${commit}\``,
  `- Compiler: Solidity 0.8.26`,
  `- Manifest hash: \`${manifestHash}\``,
  `- Evidence hash: \`${evidenceHash}\``,
  `- Administrator: \`${requiredRecordValues.administrator}\``,
  `- Treasury: \`${contracts.treasury.address}\``,
  `- Risk signer: \`${requiredRecordValues.riskSigner}\``,
  `- Relationship definition hash: \`${requiredRecordValues.relationshipDefinitionHash}\``,
  `- Rule-document hash: \`${requiredRecordValues.ruleDocumentHash}\``,
  "",
  "## Risk limits",
  "",
  ...Object.entries(riskLimits).map(([name, value]) => `- ${name}: \`${value}\``),
  "",
  "## Contracts",
  "",
  ...Object.entries(contracts).map(
    ([name, entry]) =>
      `- ${name}: \`${entry.address}\`; bytecode \`${bytecodeHashes[name]}\`; constructor \`${JSON.stringify(constructorArguments[name])}\``,
  ),
  "",
  "## Deployment transactions",
  "",
  ...Object.entries(deploymentTransactions).map(([name, hash]) => `- ${name}: \`${hash}\``),
  "",
  "No private key or secret material is recorded here.",
  "",
];
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(resolve(root, "docs/STAGING_DEPLOYMENT_RECORD.md"), lines.join("\n"));
console.log(`Recorded ${deployments.length} staging contracts; manifest ${manifestHash}.`);
