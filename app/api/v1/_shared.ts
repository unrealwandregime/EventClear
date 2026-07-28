import { NextResponse } from "next/server";

export const publicJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=15, stale-while-revalidate=45" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const productionReadonly = () =>
  publicJson(
    {
      detail: {
        code: "PRODUCTION_READONLY",
        message: "Execution and capital writes are disabled on the public deployment.",
      },
    },
    403,
  );

export function decimalToAtomic(value: unknown, decimals = 6): string {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("INVALID_DECIMAL");
  const [, sign, whole, fraction = ""] = match;
  const atomic =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  return `${sign === "-" ? "-" : ""}${atomic}`;
}

export async function polymarketGet(path: string, params: URLSearchParams) {
  const response = await fetch(`https://data-api.polymarket.com${path}?${params}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`POLYMARKET_DATA_${response.status}`);
  return response.json() as Promise<unknown>;
}
