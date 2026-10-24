// Local contract integration only. Never remote deployment evidence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "./common.mjs";
import { spawn, execFileSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";
import { readFileSync } from "node:fs";
import { limits, verifyDeployment } from "./deploy-contracts.mjs";
const rpc = "http://127.0.0.1:8557",
  chainId = 11155111;
const processHandle = spawn(
  "anvil",
  ["--silent", "--port", "8557", "--chain-id", String(chainId)],
  { stdio: "ignore" },
);
const client = createPublicClient({ transport: http(rpc, { retryCount: 0 }) });
const keys = Array.from({ length: 5 }, () => generatePrivateKey()),
  addresses = keys.map((k) => privateKeyToAccount(k).address);
try {
  for (let i = 0; i < 30; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  for (const address of addresses)
    await client.request({
      method: "anvil_setBalance",
      params: [address, "0x8ac7230489e80000"],
    });
  const env = {
    ...process.env,
    ...limits,
    STAGING_CHAIN_ID: String(chainId),
    STAGING_TEST_ASSETS_ONLY: "true",
    ENABLE_MAINNET_EXECUTION: "false",
    STAGING_DEPLOYER_PRIVATE_KEY: keys[0],
    STAGING_ADMIN_ADDRESS: addresses[1],
    RISK_SIGNER_ADDRESS: addresses[2],
    STAGING_LP_ADDRESS: addresses[3],
    STAGING_TEST_EOA: addresses[4],
    STAGING_RELATIONSHIP_HASH: "0x" + "ab".repeat(32),
    STAGING_RULES_HASH: "0x" + "cd".repeat(32),
    STAGING_EARLIEST_RESOLUTION: String(Math.floor(Date.now() / 1000) + 3600),
    STAGING_LATEST_RESOLUTION: String(Math.floor(Date.now() / 1000) + 86400),
  };
  try {
    execFileSync(
      "forge",
      [
        "script",
        "script/DeployStaging.s.sol:DeployStaging",
        "--rpc-url",
        rpc,
        "--broadcast",
      ],
      {
        cwd: "packages/contracts",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch {
    throw Error("LOCAL_STAGING_DEPLOYMENT_FAILED");
  }
  const b = JSON.parse(
    readFileSync(
      `packages/contracts/broadcast/DeployStaging.s.sol/${chainId}/run-latest.json`,
    ),
  );
  const deployed = Object.fromEntries(
    b.transactions
      .filter((t) => t.transactionType === "CREATE")
      .map((t) => [t.contractName, t.contractAddress]),
  );
  assert.equal(Object.keys(deployed).length, 10);
  for (const [name, address] of Object.entries(deployed)) {
    assert.ok((await client.getCode({ address })).length > 2);
    if (
      [
        "RelationshipRegistry",
        "EventClearClaims",
        "EventClearTreasury",
        "EventClearFundingPool",
        "RiskPolicy",
        "EventClearVault",
      ].includes(name)
    ) {
      const abi = parseAbi([
        "function hasRole(bytes32,address) view returns (bool)",
      ]);
      assert.equal(
        await client.readContract({
          address,
          abi,
          functionName: "hasRole",
          args: ["0x" + "00".repeat(32), addresses[1]],
        }),
        true,
      );
      assert.equal(
        await client.readContract({
          address,
          abi,
          functionName: "hasRole",
          args: ["0x" + "00".repeat(32), addresses[0]],
        }),
        false,
      );
    }
  }
  const lp = await client.readContract({
    address: deployed.EventClearFundingPool,
    abi: parseAbi(["function hasRole(bytes32,address) view returns (bool)"]),
    functionName: "hasRole",
    args: [
      (await import("viem")).keccak256((await import("viem")).toHex("LP_ROLE")),
      addresses[3],
    ],
  });
  assert.equal(lp, true);
  const roleCheck = await client.readContract({
    address: deployed.MockConditionalTokens,
    abi: parseAbi([
      "function balanceOf(address,uint256) view returns (uint256)",
    ]),
    functionName: "balanceOf",
    args: [addresses[4], 1n],
  });
  assert.equal(roleCheck, 100000000n);
  const names = {
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
  const payload = {
    environment: "staging",
    chainId,
    contracts: Object.fromEntries(
      Object.entries(deployed).map(([name, address]) => [
        names[name],
        { address },
      ]),
    ),
  };
  await verifyDeployment(
    {
      ...payload,
      manifestHash:
        "0x" + createHash("sha256").update(canonical(payload)).digest("hex"),
    },
    {
      ...env,
      STAGING_RPC_PRIMARY: rpc,
      STAGING_DEPLOYER_ADDRESS: addresses[0],
    },
  );
  console.log(
    "Local staging deployment: ten contracts, admin renunciation, LP role and test positions verified. No remote evidence generated.",
  );
} finally {
  processHandle.kill("SIGTERM");
}
