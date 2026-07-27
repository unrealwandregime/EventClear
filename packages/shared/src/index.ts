export type RelationshipStatus =
  | "DRAFT"
  | "EXTRACTED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "SUSPENDED"
  | "RETIRED";

export type CryptoThresholdPredicateV1 = {
  schema: "CRYPTO_THRESHOLD_V1";
  conditionId: `0x${string}`;
  questionId: `0x${string}`;
  yesTokenId: string;
  noTokenId: string;
  underlyingAsset: string;
  quoteCurrency: string;
  comparator: "GT" | "GTE" | "LT" | "LTE";
  thresholdAtomic: string;
  thresholdDecimals: number;
  observationType:
    | "CLOSING_PRICE"
    | "SETTLEMENT_INDEX"
    | "TOUCH_ANY_TIME"
    | "OFFICIAL_REPORTED_PRICE";
  observationTimestamp: string;
  observationTimezone: string;
  priceSourceName: string;
  priceSourceIdentifier: string;
  fallbackPriceSource?: string;
  resolutionSource: string;
  marketEndTimestamp: string;
  invalidMarketPayout: "HALF_HALF" | "REFUND" | "ZERO" | "CUSTOM";
  invalidCustomPayoutNumerator?: string;
  invalidCustomPayoutDenominator?: string;
  outageTreatment: string;
  roundingTreatment: string;
  ruleDocumentHash: `0x${string}`;
  reviewedBy: string;
  reviewedAt: string;
};

export type ThresholdState = {
  id: string;
  assignments: Record<string, string | boolean | number>;
  payoutsAtomicByToken: Record<string, string>;
};

export type ThresholdRelationshipDefinitionV1 = {
  schema: "THRESHOLD_RELATIONSHIP_V1";
  id: string;
  version: number;
  status: RelationshipStatus;
  predicates: CryptoThresholdPredicateV1[];
  sortedThresholdsAtomic: string[];
  canonicalValidStates: ThresholdState[];
  definitionHash: `0x${string}`;
  approvedBy: string;
  approvedAt: string;
  validFrom: string;
  validUntil?: string;
};

export type FinancingQuote = {
  borrower: `0x${string}`;
  positionWallet: `0x${string}`;
  bundleHash: `0x${string}`;
  walletAuthorizationHash: `0x${string}`;
  relationshipDefinitionHash: `0x${string}`;
  solverArtifactHash: `0x${string}`;
  earliestResolutionTimestamp: bigint;
  latestResolutionTimestamp: bigint;
  guaranteedFloor: bigint;
  principalAmount: bigint;
  grossAdvance: bigint;
  originationFee: bigint;
  netAdvance: bigint;
  expiry: bigint;
  nonce: bigint;
  chainId: bigint;
  vault: `0x${string}`;
  fundingPool: `0x${string}`;
  collateralToken: `0x${string}`;
};

export type PositionWalletAuthorization = {
  controllingSigner: `0x${string}`;
  borrower: `0x${string}`;
  positionWallet: `0x${string}`;
  bundleHash: `0x${string}`;
  vault: `0x${string}`;
  chainId: bigint;
  nonce: bigint;
  expiry: bigint;
};

export const canonicalize = (value: unknown): string => {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, visit(item)]),
      );
    }
    if (typeof input === "bigint") return input.toString(10);
    return input;
  };
  return JSON.stringify(visit(value));
};

export const BPS = 10_000n;

export function calculateQuote(
  guaranteedFloor: bigint,
  policy = { advanceRatioBps: 9_500n, originationFeeBps: 50n },
) {
  const grossAdvance = (guaranteedFloor * policy.advanceRatioBps) / BPS;
  const originationFee = (grossAdvance * policy.originationFeeBps) / BPS;
  const netAdvance = grossAdvance - originationFee;
  if (netAdvance < 0n) throw new Error("INVALID_RISK_POLICY");
  return {
    guaranteedFloor,
    principalAmount: guaranteedFloor,
    grossAdvance,
    originationFee,
    netAdvance,
  };
}
