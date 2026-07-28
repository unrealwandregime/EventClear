import assert from "node:assert/strict";
import test from "node:test";

import {
  applyIndexedEvent,
  dueDeadLetters,
  emptyProjection,
  rebuildProjection,
  reconcileProjection,
  type IndexedEvent,
} from "../src/projection.js";

const event = (
  eventName: string,
  payload: Record<string, unknown>,
  overrides: Partial<IndexedEvent> = {},
): IndexedEvent => ({
  chainId: 31337,
  blockNumber: 1n,
  transactionHash: "0x" + "11".repeat(32),
  logIndex: 0,
  eventName,
  payload,
  ...overrides,
});

test("duplicate logs are idempotent", () => {
  const opened = event("BundleOpened", {
    bundleId: "1",
    positionWallet: "0xabc",
    relationshipHash: "0xdef",
  });
  const state = emptyProjection();
  applyIndexedEvent(state, opened);
  applyIndexedEvent(state, opened);
  assert.equal(state.bundles.size, 1);
  assert.equal((state.bundles.get("1")?.eventHistory as unknown[]).length, 1);
});

test("restart from checkpoint rebuilds the same projection", () => {
  const events = [
    event("BundleOpened", { bundleId: "1" }),
    event("AdvanceFunded", {
      bundleId: "1",
      grossAdvance: "95",
      originationFee: "1",
      netAdvance: "94",
    }, { logIndex: 1 }),
  ];
  assert.deepEqual(
    [...rebuildProjection(events).bundles],
    [...rebuildProjection(events).bundles],
  );
});

test("pool settlement projects explicit reconciled return fields", () => {
  const state = rebuildProjection([
    event("AdvanceFunded", {
      bundleId: "9",
      grossAdvance: "95000000",
      originationFee: "475000",
      netAdvance: "94525000",
    }),
    event("OriginationFeeSettled", {
      bundleId: "9",
      quotedFee: "475000",
      realizedFee: "475000",
      refundedFee: "0",
    }, { logIndex: 1 }),
    event("PrincipalSettled", {
      bundleId: "9",
      principalReceived: "100000000",
      grossFinancingReturn: "5000000",
      realizedLpYield: "4547500",
      protocolFee: "452500",
    }, { logIndex: 2 }),
  ]);
  assert.equal(state.pool.realizedGrossFinancingReturnAtomic, "5000000");
  assert.equal(state.pool.realizedLpYieldAtomic, "4547500");
  assert.equal(state.pool.realizedOriginationFeesAtomic, "475000");
  assert.equal(state.pool.realizedProtocolYieldFeesAtomic, "452500");
  assert.equal(state.pool.outstandingAdvanceCostBasisAtomic, "0");
  assert.equal(state.pool.outstandingQuotedFeesAtomic, "0");
});

test("reorg rollback and removed logs exclude orphaned state", () => {
  const canonical = event("BundleOpened", { bundleId: "1" });
  const orphan = event(
    "BundleOpened",
    { bundleId: "2" },
    {
      transactionHash: "0x" + "22".repeat(32),
      blockNumber: 2n,
      removed: true,
    },
  );
  const state = rebuildProjection([orphan, canonical]);
  assert.equal(state.bundles.has("1"), true);
  assert.equal(state.bundles.has("2"), false);
});

test("dead-letter retry selects due bounded records", () => {
  const due = dueDeadLetters([
    { retryCount: 1, nextRetryAt: 10, id: "due" },
    { retryCount: 1, nextRetryAt: 30, id: "future" },
    { retryCount: 10, nextRetryAt: 0, id: "exhausted" },
  ], 20);
  assert.deepEqual(due.map((item) => item.id), ["due"]);
});

test("reconciliation compares indexed contract-facing counts", () => {
  const state = rebuildProjection([
    event("BundleOpened", { bundleId: "1" }),
    event("ClaimsMinted", {
      bundleId: "1",
      principalSupply: "100",
      residualSupply: "1000",
    }, { logIndex: 1 }),
  ]);
  assert.equal(reconcileProjection(state, { bundles: 1, claims: 2 }).matches, true);
  assert.equal(reconcileProjection(state, { bundles: 2, claims: 2 }).matches, false);
});

test("multi-contract event ordering is block then log index", () => {
  const state = rebuildProjection([
    event("BundleSettled", {
      bundleId: "7",
      principalAllocation: "100",
      residualAllocation: "20",
    }, { blockNumber: 5n, logIndex: 9 }),
    event("SettlementStarted", { bundleId: "7" }, { blockNumber: 5n, logIndex: 2 }),
    event("BundleOpened", { bundleId: "7" }, { blockNumber: 4n, logIndex: 8 }),
  ]);
  assert.equal(state.bundles.get("7")?.status, "SETTLED");
  assert.deepEqual(
    (state.bundles.get("7")?.eventHistory as Array<{ logIndex: number }>).map((item) => item.logIndex),
    [8, 2, 9],
  );
});
