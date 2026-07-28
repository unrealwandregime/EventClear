import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, keccak256 } from "viem";

const rpcUrl = process.env.STAGING_RPC_URL;
if (!rpcUrl) throw new Error("STAGING_RPC_URL_REQUIRED");
const chainId = Number(process.env.CHAIN_ID ?? "31337");
if (chainId !== 31337) throw new Error("STAGING_CHAIN_ID_MUST_BE_31337");

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
const lines = [
  "# Staging deployment record",
  "",
  `- Deployment timestamp: ${new Date().toISOString()}`,
  `- Network: controlled remote Anvil`,
  `- Chain ID: ${chainId}`,
  `- Git commit: \`${commit}\``,
  `- Compiler: Solidity 0.8.26`,
  `- Manifest hash: \`${manifestHash}\``,
  `- Administrator: \`${process.env.STAGING_ADMIN_ADDRESS ?? "not-recorded"}\``,
  `- Risk signer: \`${process.env.RISK_SIGNER_ADDRESS ?? "not-recorded"}\``,
  "",
  "## Contracts",
  "",
  ...Object.entries(contracts).map(
    ([name, entry]) => `- ${name}: \`${entry.address}\` (${bytecodeHashes[name]})`,
  ),
  "",
  "## Deployment transactions",
  "",
  ...deployments.map(
    (item) => `- ${item.contractName}: \`${item.hash ?? "transaction-hash-unavailable"}\``,
  ),
  "",
  "No private key or secret material is recorded here.",
  "",
];
await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(resolve(root, "docs/STAGING_DEPLOYMENT_RECORD.md"), lines.join("\n"));
console.log(`Recorded ${deployments.length} staging contracts; manifest ${manifestHash}.`);
