import { publicJson } from "../../_shared";

export const runtime = "edge";

export function GET() {
  return publicJson({
    available: false,
    source: "indexed",
    reason: "EVENTCLEAR_MAINNET_CONTRACTS_NOT_DEPLOYED",
  });
}
