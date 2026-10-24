/** Bounded RPC log requests let sleeping free hosts resume without provider range errors. */
export function* blockRanges(from: bigint, to: bigint, size: bigint): Generator<[bigint, bigint]> {
  if (size < 1n || size > 10_000n) throw new Error("INVALID_INDEXER_BATCH_SIZE");
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    yield [start, end < to ? end : to];
  }
}
