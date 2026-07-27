import { isAddress } from "viem";

import { decimalToAtomic, polymarketGet, publicJson } from "../../../_shared";

export const runtime = "edge";

type RawPosition = Record<string, unknown>;

export async function GET(
  _: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  if (!isAddress(address)) return publicJson({ error: { code: "INVALID_ADDRESS" } }, 422);
  try {
    const raw = await polymarketGet(
      "/positions",
      new URLSearchParams({ user: address, sizeThreshold: "0" }),
    );
    if (!Array.isArray(raw)) throw new Error("POLYMARKET_POSITION_SCHEMA");
    const positions = raw.flatMap((item: RawPosition) => {
      if (!item.asset) return [];
      try {
        return [{
          conditionId: item.conditionId ?? null,
          tokenId: String(item.asset),
          outcome: String(item.outcome ?? ""),
          amountAtomic: decimalToAtomic(item.size),
          currentValueAtomic: decimalToAtomic(item.currentValue),
          title: String(item.title ?? ""),
          negativeRisk: Boolean(item.negativeRisk),
          source: "polymarket-data-api-live",
        }];
      } catch {
        return [];
      }
    });
    return publicJson({
      signerAddress: address,
      positionWallet: address,
      walletType: "UNVERIFIED",
      executionSupported: false,
      positions,
      source: "polymarket-data-api-live",
    });
  } catch (error) {
    return publicJson(
      { error: { code: error instanceof Error ? error.message : "POLYMARKET_READ_UNAVAILABLE" } },
      503,
    );
  }
}
