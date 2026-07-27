import { createPublicClient, erc20Abi, http, parseAbi, zeroAddress } from "viem";
import { polygon } from "viem/chains";
import manifest from "../config/polygon-mainnet.contracts.json" with { type: "json" };

const fail = (message: string): never => {
  throw new Error(message);
};

if (manifest.chainId !== 137) fail("Manifest chain ID is not Polygon mainnet");

const configuredAddresses = {
  PUSD_ADDRESS: "pUSD",
  USDCE_ADDRESS: "usdce",
  CTF_ADDRESS: "conditionalTokens",
  CTF_COLLATERAL_ADAPTER_ADDRESS: "ctfCollateralAdapter",
  NEG_RISK_COLLATERAL_ADAPTER_ADDRESS: "negativeRiskCollateralAdapter",
} as const;

for (const [environmentKey, manifestKey] of Object.entries(configuredAddresses)) {
  const configured = process.env[environmentKey];
  const reviewed = manifest.contracts[manifestKey as keyof typeof manifest.contracts].address;
  if (process.env.EVENTCLEAR_MODE === "polygon-mainnet" && !configured) {
    fail(`${environmentKey} is required in polygon-mainnet mode`);
  }
  if (configured && configured.toLowerCase() !== reviewed.toLowerCase()) {
    fail(`${environmentKey} does not match the reviewed production manifest`);
  }
}

const rpcUrls = (process.env.POLYGON_RPC_URLS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
if (!rpcUrls.length) fail("POLYGON_RPC_URLS is required");
if (process.env.EVENTCLEAR_MODE === "polygon-mainnet" && rpcUrls.length < 2) {
  fail("At least two independent Polygon RPC URLs are required in mainnet mode");
}

const ctfAbi = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);
const adapterAbi = parseAbi([
  "function CONDITIONAL_TOKENS() view returns (address)",
  "function COLLATERAL_TOKEN() view returns (address)",
  "function USDCE() view returns (address)",
]);
const negativeAdapterAbi = parseAbi([
  "function NEG_RISK_ADAPTER() view returns (address)",
]);

const addresses = Object.entries(manifest.contracts);
for (const [name, entry] of addresses) {
  if (entry.address.toLowerCase() === zeroAddress) fail(`${name} is zero`);
}

for (const rpcUrl of rpcUrls) {
  const client = createPublicClient({ chain: polygon, transport: http(rpcUrl) });
  if (await client.getChainId() !== 137) fail(`RPC is not Polygon mainnet: ${rpcUrl}`);

  const bytecodes = await Promise.all(
    addresses.map(([, entry]) => client.getCode({ address: entry.address as `0x${string}` })),
  );
  bytecodes.forEach((code, index) => {
    if (!code || code === "0x") fail(`${addresses[index][0]} has no bytecode on ${rpcUrl}`);
  });

  const collateral = manifest.contracts.pUSD.address as `0x${string}`;
  const usdce = manifest.contracts.usdce.address as `0x${string}`;
  const ctf = manifest.contracts.conditionalTokens.address as `0x${string}`;
  const standardAdapter = manifest.contracts.ctfCollateralAdapter.address as `0x${string}`;
  const negativeAdapter = manifest.contracts.negativeRiskCollateralAdapter.address as `0x${string}`;
  const [symbol, decimals, usdceDecimals, supports1155, standardCtf, standardCollateral, standardUsdce] =
    await Promise.all([
      client.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: usdce, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: ctf, abi: ctfAbi, functionName: "supportsInterface", args: ["0xd9b67a26"] }),
      client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "CONDITIONAL_TOKENS" }),
      client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "COLLATERAL_TOKEN" }),
      client.readContract({ address: standardAdapter, abi: adapterAbi, functionName: "USDCE" }),
    ]);

  if (symbol !== "pUSD" || decimals !== 6) fail(`Unexpected pUSD metadata: ${symbol}/${decimals}`);
  if (usdceDecimals !== 6) fail(`Unexpected USDC.e decimals: ${usdceDecimals}`);
  if (!supports1155) fail("Configured CTF does not support ERC-1155");
  if (standardCtf.toLowerCase() !== ctf.toLowerCase()) fail("Standard adapter CTF mismatch");
  if (standardCollateral.toLowerCase() !== collateral.toLowerCase()) fail("Standard adapter pUSD mismatch");
  if (standardUsdce.toLowerCase() !== usdce.toLowerCase()) fail("Standard adapter USDC.e mismatch");

  const [negativeCtf, negativeCollateral, negativeUsdce, legacyNegativeAdapter] = await Promise.all([
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "CONDITIONAL_TOKENS" }),
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "COLLATERAL_TOKEN" }),
    client.readContract({ address: negativeAdapter, abi: adapterAbi, functionName: "USDCE" }),
    client.readContract({ address: negativeAdapter, abi: negativeAdapterAbi, functionName: "NEG_RISK_ADAPTER" }),
  ]);
  if (negativeCtf.toLowerCase() !== ctf.toLowerCase()) fail("Negative-risk adapter CTF mismatch");
  if (negativeCollateral.toLowerCase() !== collateral.toLowerCase()) fail("Negative-risk adapter pUSD mismatch");
  if (negativeUsdce.toLowerCase() !== usdce.toLowerCase()) fail("Negative-risk adapter USDC.e mismatch");
  if (
    legacyNegativeAdapter.toLowerCase()
    !== manifest.contracts.negativeRiskAdapter.address.toLowerCase()
  ) {
    fail("Negative-risk adapter legacy dependency mismatch");
  }
}

console.log(`reviewed manifest verified through ${rpcUrls.length} RPC provider(s)`);
