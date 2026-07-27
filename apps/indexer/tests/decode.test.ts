import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import type { Hex } from "viem";

import { decodeProtocolLog, protocolAbi } from "../src/index.js";

test("decodes a bundle settlement without losing integer precision", () => {
  const topics = encodeEventTopics({
    abi: protocolAbi,
    eventName: "BundleSettled",
    args: { bundleId: 418n },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [100_000_000n, 80_000_000n],
  );

  const decoded = decodeProtocolLog({ data, topics: topics as [Hex, ...Hex[]] });
  assert.equal(decoded.eventName, "BundleSettled");
  assert.equal(decoded.args.bundleId, 418n);
  assert.equal(decoded.args.principalAllocation, 100_000_000n);
  assert.equal(decoded.args.residualAllocation, 80_000_000n);
});
