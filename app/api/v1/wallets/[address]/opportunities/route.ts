import { isAddress } from "viem";

import { publicJson } from "../../../_shared";

export const runtime = "edge";

export async function GET(
  _: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;
  if (!isAddress(address)) return publicJson({ error: { code: "INVALID_ADDRESS" } }, 422);
  return publicJson({
    positionWallet: address,
    candidates: [],
    reason: "NO_APPROVED_EVENTCLEAR_MAINNET_RELATIONSHIPS",
    source: "live",
  });
}
