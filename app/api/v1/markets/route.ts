import { publicJson } from "../_shared";

export const runtime = "edge";

export async function GET() {
  try {
    const response = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=100",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) throw new Error(`POLYMARKET_GAMMA_${response.status}`);
    const raw = await response.json() as unknown;
    if (!Array.isArray(raw)) throw new Error("POLYMARKET_GAMMA_SCHEMA");
    return publicJson({
      data: raw.flatMap((item) => {
        if (!item || typeof item !== "object" || !("conditionId" in item)) return [];
        const market = item as Record<string, unknown>;
        let outcomePrices: unknown[] = [];
        if (typeof market.outcomePrices === "string") {
          try {
            const parsed = JSON.parse(market.outcomePrices) as unknown;
            outcomePrices = Array.isArray(parsed) ? parsed : [];
          } catch {
            outcomePrices = [];
          }
        } else if (Array.isArray(market.outcomePrices)) {
          outcomePrices = market.outcomePrices;
        }
        return [{
          conditionId: market.conditionId,
          marketId: String(market.id ?? ""),
          question: String(market.question ?? ""),
          endDate: market.endDateIso ?? market.endDate ?? null,
          negativeRisk: Boolean(market.negRisk),
          slug: String(market.slug ?? ""),
          yesPrice: outcomePrices[0] === undefined ? null : Number(outcomePrices[0]),
          noPrice: outcomePrices[1] === undefined ? null : Number(outcomePrices[1]),
          liquidity: Number(market.liquidityNum ?? market.liquidity ?? 0),
          volume24h: Number(market.volume24hr ?? 0),
          acceptingOrders: Boolean(market.acceptingOrders),
          source: "polymarket-gamma-live",
        }];
      }),
      stale: false,
      source: "polymarket-gamma-live",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return publicJson(
      { error: { code: error instanceof Error ? error.message : "POLYMARKET_READ_UNAVAILABLE" } },
      503,
    );
  }
}
