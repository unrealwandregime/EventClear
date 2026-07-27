import { createPublicClient, type Market, type TokenId } from "@polymarket/client";

export type Fresh<T> = { data: T; observedAt: number; stale: boolean };

export class PolymarketGateway {
  readonly client = createPublicClient();
  #lastEventAt = 0;

  async listActiveMarkets(pageSize = 100): Promise<Fresh<Market[]>> {
    const page = await this.client.listMarkets({ closed: false, pageSize }).firstPage();
    const observedAt = Date.now();
    return { data: page.items, observedAt, stale: false };
  }

  async *marketStream(tokenIds: TokenId[], signal?: AbortSignal) {
    let delay = 500;
    while (!signal?.aborted) {
      try {
        const stream = await this.client.subscribe([{ topic: "market", tokenIds }]);
        delay = 500;
        for await (const event of stream) {
          if (signal?.aborted) {
            await stream.close();
            return;
          }
          const timestamp = Date.now();
          if (timestamp < this.#lastEventAt) continue;
          this.#lastEventAt = timestamp;
          yield { data: event, observedAt: timestamp, stale: false };
        }
      } catch (error) {
        yield { data: { topic: "connection", error: String(error) }, observedAt: Date.now(), stale: true };
        await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 250));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }
}
