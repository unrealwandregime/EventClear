export type RelationshipType =
  | "CRYPTO_THRESHOLD"
  | "ELECTION_IMPLICATION"
  | "SPORTS_PROGRESSION"
  | "MANUAL_TRUTH_TABLE";

export type RelationshipStatus = "DRAFT" | "REVIEW" | "APPROVED" | "SUSPENDED" | "RETIRED";

export interface RelationshipDefinition {
  id: string;
  version: number;
  relationshipType: RelationshipType;
  status: RelationshipStatus;
  marketConditionIds: string[];
  tokenIds: string[];
  normalizedPredicates: Array<Record<string, unknown>>;
  constraints: Array<Record<string, unknown>>;
  validPayoutVectors: Array<Record<string, unknown>>;
  resolutionRulesHash: `0x${string}`;
  canonicalDefinitionHash: `0x${string}`;
  approvedBy: string;
  approvedAt: string;
  validFrom: string;
  validUntil?: string;
}

export interface FinancingQuote {
  accountWallet: `0x${string}`;
  bundleHash: `0x${string}`;
  relationshipDefinitionHash: `0x${string}`;
  solverProofHash: `0x${string}`;
  guaranteedFloor: bigint;
  principalAmount: bigint;
  advanceAmount: bigint;
  originationFee: bigint;
  expiry: bigint;
  nonce: bigint;
  chainId: bigint;
  vault: `0x${string}`;
}

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
  floor: bigint,
  policy = { maximumAdvanceBps: 9_500n, reserveHaircutBps: 100n, originationFeeBps: 50n },
) {
  const originationFee = (floor * policy.originationFeeBps) / BPS;
  const reserveHaircut = (floor * policy.reserveHaircutBps) / BPS;
  const advanceAmount = (floor * policy.maximumAdvanceBps) / BPS - reserveHaircut - originationFee;
  if (advanceAmount < 0n) throw new Error("INVALID_RISK_POLICY");
  return { principalAmount: floor, advanceAmount, reserveHaircut, originationFee };
}
