import { publicJson } from "../../_shared";

export const runtime = "edge";

export function GET() {
  return publicJson({
    mode: "production-readonly",
    environment: "Production read-only",
    chainId: 137,
    mainnetExecution: false,
    publicCapitalActivated: false,
    dataSource: "Live Polymarket public APIs",
    executionStatus: "Mainnet execution disabled",
    contractDeploymentStatus: "EventClear contracts not deployed on production",
    indexerStatus: "Unavailable — no production contracts",
    relationshipDatabaseStatus: "Not published",
    auditStatus: "Independent audit not complete",
    legalStatus: "Legal approval not complete",
    capitalStatus: "No public capital activated",
    vaultAddress: null,
    fundingPoolAddress: null,
    collateralTokenAddress: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  });
}
