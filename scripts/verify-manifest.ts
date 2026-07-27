import { createPublicClient, erc20Abi, http, zeroAddress } from "viem";
import { polygon } from "viem/chains";
import manifest from "../config/polygon-mainnet.contracts.json" with { type: "json" };

const fail = (message: string): never => { throw new Error(message); };
if (manifest.chainId !== 137) fail("Manifest chain ID is not Polygon mainnet");
const rpcUrls = (process.env.POLYGON_RPC_URLS ?? "").split(",").filter(Boolean);
if (!rpcUrls.length) fail("POLYGON_RPC_URLS is required");
const client = createPublicClient({ chain: polygon, transport: http(rpcUrls[0]) });
for (const [name, entry] of Object.entries(manifest.contracts)) {
  if (entry.address.toLowerCase() === zeroAddress) fail(`${name} is zero; reviewed production manifest is not populated`);
  const code = await client.getCode({ address: entry.address as `0x${string}` });
  if (!code || code === "0x") fail(`${name} has no bytecode`);
}
const collateral = manifest.contracts.pUSD.address as `0x${string}`;
const [symbol, decimals] = await Promise.all([
  client.readContract({ address: collateral, abi: erc20Abi, functionName: "symbol" }),
  client.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" }),
]);
if (symbol !== "pUSD" || decimals !== 6) fail(`Unexpected pUSD metadata: ${symbol}/${decimals}`);
console.log("reviewed manifest verified");
