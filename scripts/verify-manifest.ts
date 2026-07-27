import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { polygon } from "viem/chains";

type ContractEntry = {
  address: `0x${string}`;
  kind: string;
  notes?: string;
};

type Manifest = {
  environment: "local" | "polygon-fork" | "polygon-mainnet";
  chainId: number;
  reviewedAt: string;
  registrySource: string;
  manifestHash: `0x${string}`;
  contracts: Record<string, ContractEntry>;
};

const fail = (message: string): never => {
  throw new Error(message);
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestDigest(manifest: Manifest): `0x${string}` {
  const payload = { ...manifest, manifestHash: undefined };
  delete payload.manifestHash;
  return `0x${createHash("sha256").update(canonical(payload)).digest("hex")}`;
}

const environment = process.env.EVENTCLEAR_ENV ?? process.env.EVENTCLEAR_MODE ?? "polygon-mainnet";
const normalizedEnvironment = environment === "polygon-mainnet" ? "polygon-mainnet" : environment;
if (!["local", "polygon-fork", "polygon-mainnet"].includes(normalizedEnvironment)) {
  fail(`Unsupported manifest environment: ${environment}`);
}

const manifestPath = resolve(
  process.env.CONTRACT_MANIFEST_PATH ?? `config/contracts/${normalizedEnvironment}.json`,
);
const schemaPath = resolve("config/contracts/schema.json");
const [manifestText, schemaText] = await Promise.all([
  readFile(manifestPath, "utf8"),
  readFile(schemaPath, "utf8"),
]);
const manifest = JSON.parse(manifestText) as Manifest;
const schema = JSON.parse(schemaText);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(manifest)) fail(`Manifest schema invalid: ${ajv.errorsText(validate.errors)}`);
if (manifest.environment !== normalizedEnvironment) fail("Manifest environment does not match selected environment");
if (Number.isNaN(Date.parse(manifest.reviewedAt))) fail("Manifest review timestamp is invalid");

const digest = manifestDigest(manifest);
if (process.argv.includes("--write-hash")) {
  const updated = { ...manifest, manifestHash: digest };
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`${manifestPath}: ${digest}`);
  process.exit(0);
}
if (manifest.manifestHash !== digest) {
  fail(`Manifest hash mismatch: expected ${digest}, received ${manifest.manifestHash}`);
}

for (const [name, entry] of Object.entries(manifest.contracts)) {
  if (entry.address.toLowerCase() === zeroAddress) fail(`${name} is zero`);
  if (getAddress(entry.address) !== entry.address) fail(`${name} is not EIP-55 checksummed`);
}

const expectedChainId = manifest.environment === "local" ? 31337 : 137;
if (manifest.chainId !== expectedChainId) fail(`Unexpected chain ID ${manifest.chainId}`);
if (manifest.environment === "local" && Object.keys(manifest.contracts).length === 0) {
  console.log(`verified local deployment-template manifest ${manifest.manifestHash}`);
  process.exit(0);
}

const required = [
  "conditionalTokens",
  "pUSD",
  "usdce",
  "ctfCollateralAdapter",
  "negativeRiskCollateralAdapter",
  "negativeRiskAdapter",
] as const;
for (const name of required) {
  if (!manifest.contracts[name]) fail(`Required contract missing: ${name}`);
}

const configuredAddresses = {
  PUSD_ADDRESS: "pUSD",
  USDCE_ADDRESS: "usdce",
  CTF_ADDRESS: "conditionalTokens",
  CTF_COLLATERAL_ADAPTER_ADDRESS: "ctfCollateralAdapter",
  NEG_RISK_COLLATERAL_ADAPTER_ADDRESS: "negativeRiskCollateralAdapter",
} as const;
for (const [environmentKey, manifestKey] of Object.entries(configuredAddresses)) {
  const configured = process.env[environmentKey];
  const reviewed = manifest.contracts[manifestKey].address;
  if (manifest.environment === "polygon-mainnet" && !configured && process.env.EVENTCLEAR_MODE === "production-controlled") {
    fail(`${environmentKey} is required in controlled production`);
  }
  if (configured && getAddress(configured) !== reviewed) {
    fail(`${environmentKey} does not match the reviewed manifest`);
  }
}

const rpcUrls = (process.env.POLYGON_RPC_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!rpcUrls.length) fail("POLYGON_RPC_URLS is required for Polygon manifests");
if (manifest.environment === "polygon-mainnet" && rpcUrls.length < 2) {
  fail("At least two independent Polygon RPC URLs are required for mainnet verification");
}

const ctfAbi = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const adapterAbi = parseAbi([
  "function CONDITIONAL_TOKENS() view returns (address)",
  "function COLLATERAL_TOKEN() view returns (address)",
  "function USDCE() view returns (address)",
]);
const negativeAdapterAbi = parseAbi(["function NEG_RISK_ADAPTER() view returns (address)"]);
const nameAbi = parseAbi(["function name() view returns (string)"]);
const entries = Object.entries(manifest.contracts);

for (const rpcUrl of rpcUrls) {
  const client = createPublicClient({ chain: polygon, transport: http(rpcUrl, { timeout: 20_000 }) });
  if (await client.getChainId() !== manifest.chainId) fail(`RPC chain mismatch: ${rpcUrl}`);

  const bytecodes = await Promise.all(
    entries.map(([, entry]) => client.getCode({ address: entry.address })),
  );
  bytecodes.forEach((code, index) => {
    if (!code || code === "0x") fail(`${entries[index][0]} has no bytecode on ${rpcUrl}`);
  });

  const collateral = manifest.contracts.pUSD.address;
  const usdce = manifest.contracts.usdce.address;
  const ctf = manifest.contracts.conditionalTokens.address;
  const standardAdapter = manifest.contracts.ctfCollateralAdapter.address;
  const negativeAdapter = manifest.contracts.negativeRiskCollateralAdapter.address;
  const [
    name,
    symbol,
    decimals,
    usdceDecimals,
    supports1155,
    standardCtf,
    standardCollateral,
    standardUsdce,
  ] = await Promise.all([
    client.readContract({ address: collateral, abi: nameAbi, functionName: "name" }),
    client.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: usdce, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: ctf, abi: ctfAbi, functionName: "supportsInterface", args: ["0xd9b67a26"] }),
    client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "CONDITIONAL_TOKENS" }),
    client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "COLLATERAL_TOKEN" }),
    client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "USDCE" }),
  ]);

  if (name !== "Polymarket USD" || symbol !== "pUSD" || decimals !== 6) {
    fail(`Unexpected pUSD metadata: ${name}/${symbol}/${decimals}`);
  }
  if (usdceDecimals !== 6) fail(`Unexpected USDC.e decimals: ${usdceDecimals}`);
  if (!supports1155) fail("Configured CTF does not support ERC-1155");
  if (getAddress(standardCtf) !== ctf) fail("Standard adapter CTF mismatch");
  if (getAddress(standardCollateral) !== collateral) fail("Standard adapter pUSD mismatch");
  if (getAddress(standardUsdce) !== usdce) fail("Standard adapter USDC.e mismatch");

  const [negativeCtf, negativeCollateral, negativeUsdce, legacyNegativeAdapter] = await Promise.all([
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "CONDITIONAL_TOKENS" }),
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "COLLATERAL_TOKEN" }),
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "USDCE" }),
    client.readContract({ address: negativeAdapter, abi: negativeAdapterAbi, functionName: "NEG_RISK_ADAPTER" }),
  ]);
  if (getAddress(negativeCtf) !== ctf) fail("Negative-risk adapter CTF mismatch");
  if (getAddress(negativeCollateral) !== collateral) fail("Negative-risk adapter pUSD mismatch");
  if (getAddress(negativeUsdce) !== usdce) fail("Negative-risk adapter USDC.e mismatch");
  if (getAddress(legacyNegativeAdapter) !== manifest.contracts.negativeRiskAdapter.address) {
    fail("Negative-risk adapter legacy dependency mismatch");
  }
}

console.log(
  `verified ${manifest.environment} manifest ${manifest.manifestHash} through ${rpcUrls.length} RPC provider(s)`,
);
