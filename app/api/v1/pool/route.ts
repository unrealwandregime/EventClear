import { publicJson } from "../_shared";

export const runtime = "edge";

export function GET() {
  return publicJson(
    { error: { code: "EVENTCLEAR_MAINNET_POOL_NOT_DEPLOYED" } },
    503,
  );
}
