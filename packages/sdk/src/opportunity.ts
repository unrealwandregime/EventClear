export type ThresholdMarket = {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  asset: string;
  quoteCurrency: string;
  thresholdAtomic: bigint;
  observationType: "CLOSE_AT" | "TRADES_ABOVE" | "REACHES_ANY_TIME" | "INDEX_SETTLES_AT";
  observationTimestamp: string;
  timeZone: string;
  marketExpiry: string;
  priceSource: string;
  resolutionSource: string;
  spikeTreatment: string;
  outageTreatment: string;
  unavailableDataTreatment: string;
  invalidMarketTreatment: string;
  rulesHash: `0x${string}`;
};

const compatibilityKeys = [
  "asset", "quoteCurrency", "observationType", "observationTimestamp", "timeZone", "marketExpiry",
  "priceSource", "resolutionSource", "spikeTreatment", "outageTreatment", "unavailableDataTreatment",
  "invalidMarketTreatment",
] as const;

export function discoverThresholdBundles(
  markets: ThresholdMarket[],
  positions: Map<string, bigint>,
) {
  const candidates: Array<Record<string, unknown>> = [];
  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const [low, high] = markets[i].thresholdAtomic < markets[j].thresholdAtomic
        ? [markets[i], markets[j]] : [markets[j], markets[i]];
      const mismatches = compatibilityKeys.filter((key) => low[key] !== high[key]);
      const yesAmount = positions.get(low.yesTokenId) ?? 0n;
      const noAmount = positions.get(high.noTokenId) ?? 0n;
      if (!yesAmount || !noAmount) continue;
      if (mismatches.length) {
        candidates.push({ status: "REJECTED", legs: [low.yesTokenId, high.noTokenId], reasons: mismatches.map((key) => `INCOMPATIBLE_${key.toUpperCase()}`) });
        continue;
      }
      const floor = yesAmount < noAmount ? yesAmount : noAmount;
      const maximum = yesAmount + noAmount;
      candidates.push({ status: "FORMAL_DEFINITION_REQUIRED", legs: [low.yesTokenId, high.noTokenId], preliminaryFloorAtomic: floor.toString(), preliminaryMaximumAtomic: maximum.toString(), reasons: ["REGISTERED_RELATIONSHIP_REQUIRED"] });
    }
  }
  return candidates;
}
