import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type BroadcastTransaction = {
  transactionType: string;
  contractName?: string;
  contractAddress?: string;
};

const root = process.cwd();
const broadcastPath = path.join(
  root,
  "packages",
  "contracts",
  "broadcast",
  "DeployLocal.s.sol",
  "31337",
  "run-latest.json",
);
const broadcast = JSON.parse(await readFile(broadcastPath, "utf8")) as {
  transactions: BroadcastTransaction[];
};
const addresses = Object.fromEntries(
  broadcast.transactions
    .filter(
      (transaction) =>
        transaction.transactionType === "CREATE" &&
        transaction.contractName &&
        transaction.contractAddress,
    )
    .map((transaction) => [transaction.contractName!, transaction.contractAddress!]),
);

const required = [
  "MockPUSD",
  "MockConditionalTokens",
  "MockCTFAdapter",
  "RelationshipRegistry",
  "EventClearClaims",
  "EventClearTreasury",
  "EventClearFundingPool",
  "RiskPolicy",
  "EventClearVault",
];
for (const name of required) {
  if (!addresses[name]) throw new Error(`LOCAL_DEPLOYMENT_MISSING_${name}`);
}

const deploymentDir = path.join(root, "config", "deployments");
await mkdir(deploymentDir, { recursive: true });
await writeFile(
  path.join(deploymentDir, "local.json"),
  `${JSON.stringify({ chainId: 31337, source: "foundry-broadcast", contracts: addresses }, null, 2)}\n`,
);
await writeFile(
  path.join(deploymentDir, "local.env"),
  [
    `VAULT_ADDRESS=${addresses.EventClearVault}`,
    `CLAIMS_ADDRESS=${addresses.EventClearClaims}`,
    `FUNDING_POOL_ADDRESS=${addresses.EventClearFundingPool}`,
    `COLLATERAL_TOKEN_ADDRESS=${addresses.MockPUSD}`,
    `CTF_ADDRESS=${addresses.MockConditionalTokens}`,
    `STANDARD_CTF_ADAPTER_ADDRESS=${addresses.MockCTFAdapter}`,
    `RELATIONSHIP_REGISTRY_ADDRESS=${addresses.RelationshipRegistry}`,
    `TREASURY_ADDRESS=${addresses.EventClearTreasury}`,
    `RISK_POLICY_ADDRESS=${addresses.RiskPolicy}`,
    "",
  ].join("\n"),
);
console.log(`Synchronized ${required.length} local contract addresses from ${broadcastPath}`);
