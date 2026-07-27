export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  session?: string,
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (session) headers.set("authorization", `Bearer ${session}`);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      detail?: { code?: string; reason?: string };
    };
    throw new Error(body.detail?.code ?? `API_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const idempotencyKey = (action: string) =>
  `${action}-${crypto.randomUUID()}`;

export const formatPusd = (atomic?: string) =>
  atomic === undefined
    ? "Unavailable"
    : (Number(atomic) / 1_000_000).toLocaleString(undefined, {
        maximumFractionDigits: 6,
      });

export async function waitForIndexedEvents(
  transactionHash: string,
  expectedEvents: string[],
  attempts = 45,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await apiFetch<{
      data: Array<{ transactionHash?: string; eventName?: string }>;
    }>("/protocol/events");
    const names = new Set(
      response.data
        .filter((event) =>
          event.transactionHash?.toLowerCase() === transactionHash.toLowerCase()
        )
        .map((event) => event.eventName),
    );
    if (expectedEvents.every((event) => names.has(event))) return names;
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
  throw new Error("INDEXER_CONFIRMATION_TIMEOUT");
}
