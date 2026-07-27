import { publicJson } from "../_shared";

export const runtime = "edge";

export function GET() {
  return publicJson({ data: [], source: "indexed", chainId: 137 });
}
