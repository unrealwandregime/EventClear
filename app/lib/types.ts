export type Hex = `0x${string}`;

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type PublicConfig = {
  chainId: number;
  mainnetExecution: boolean;
  environment: string;
  dataSource: string;
  executionStatus: string;
  contractDeploymentStatus: string;
  indexerStatus: string;
  relationshipDatabaseStatus: string;
  vaultAddress: Hex;
  fundingPoolAddress: Hex;
  collateralTokenAddress: Hex;
  conditionalTokensAddress: Hex;
  siweDomain?: string;
  siweUri?: string;
};

export type PositionRecord = {
  conditionId: string;
  tokenId: string;
  outcome: "YES" | "NO";
  amountAtomic: string;
  currentValueAtomic?: string;
  title?: string;
};

export type SelectedLeg = PositionRecord & { selectedAmountAtomic: string };

export type RelationshipRecord = {
  id: string;
  relationshipType: string;
  version: number;
  status: string;
  resolutionRulesHash: string;
  canonicalDefinitionHash: Hex;
  earliestResolutionTimestamp: number;
  latestResolutionTimestamp: number;
  reviewedMarkets?: Array<{
    conditionId: string;
    tokenIds: Record<"YES" | "NO", string>;
  }>;
};

export type SolverWorld = {
  worldId: string;
  assignments: Record<string, string | number | boolean>;
  totalPayoutAtomic: string;
  payoutsAtomicByLeg: string[];
};

export type AnalysisRecord = {
  id: string;
  solverResult: {
    financingEligible: boolean;
    guaranteedFloorAtomic: string;
    maximumPayoutAtomic: string;
    terminalWorlds: SolverWorld[];
    minimumWitnessWorlds: SolverWorld[];
    maximumWitnessWorlds: SolverWorld[];
    solverVersion: string;
    definitionHash: Hex;
    artifactHash: Hex;
  };
  artifact: {
    request: {
      relationshipDefinitionHash: Hex;
      relationshipVersion: number;
      legs: Array<{
        conditionId: string;
        tokenId: string;
        outcome: "YES" | "NO";
        amountAtomic: string;
      }>;
    };
  };
  relationship: {
    id: string;
    version: number;
    ruleDocumentHash: Hex;
    earliestResolutionTimestamp: number;
    latestResolutionTimestamp: number;
  };
};

export type QuoteRecord = {
  id: string;
  quote: Record<string, string>;
  signature: Hex;
  riskSigner: Hex;
  solverResult: AnalysisRecord["solverResult"];
  typedData: Record<string, unknown>;
  walletAuthorization: {
    authorization: Record<string, string>;
    typedData: Record<string, unknown>;
  };
};

export type PreparedTransaction = {
  action: string;
  chainId: number;
  expectedSelector: Hex;
  transactionRequest: { to: Hex; data: Hex; value: Hex };
  simulation: { status: string; gasEstimate: string };
  correlationId: string;
};

export type TransactionStage = {
  action: string;
  hash?: Hex;
  status: "requested" | "submitted" | "confirmed" | "failed";
  updatedAt: number;
};
