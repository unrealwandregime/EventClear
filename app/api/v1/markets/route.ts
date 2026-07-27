import { publicJson } from "../_shared";

export const runtime = "edge";

export async function GET() {
  try {
    const response = await fetch(
      "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) throw new Error(`POLYMARKET_GAMMA_${response.status}`);
    const raw = await response.json() as unknown;
    if (!Array.isArray(raw)) throw new Error("POLYMARKET_GAMMA_SCHEMA");
    return publicJson({
      data: raw.flatMap((item) => {
        if (!item || typeof item !== "object" || !("conditionId" in item)) return [];
        const market = item as Record<string, unknown>;
        return [{
          conditionId: market.conditionId,
          marketId: String(market.id ?? ""),
          question: String(market.question ?? ""),
          endDate: market.endDateIso ?? market.endDate ?? null,
          negativeRisk: Boolean(market.negRisk),
          source: "polymarket-gamma-live",
        }];
      }),
      stale: false,
      source: "polymarket-gamma-live",
    });
  } catch (error) {
    return publicJson(
      { error: { code: error instanceof Error ? error.message : "POLYMARKET_READ_UNAVAILABLE" } },
      503,
    );
  }
}
