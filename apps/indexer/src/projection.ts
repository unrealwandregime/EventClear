export type IndexedEvent = {
  chainId: number;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  payload: Record<string, unknown>;
  removed?: boolean;
};

export type Projection = {
  applied: Set<string>;
  bundles: Map<string, Record<string, unknown>>;
  claims: Map<string, Record<string, unknown>>;
  claimBalances: Map<string, Map<string, bigint>>;
  relationships: Map<string, Record<string, unknown>>;
  protocolEvents: Map<string, Record<string, unknown>>;
  poolAccounts: Map<string, Record<string, unknown>>;
  pool: Record<string, unknown>;
  treasuryFees: Record<string, bigint>;
};

export const emptyProjection = (): Projection => ({
  applied: new Set(),
  bundles: new Map(),
  claims: new Map(),
  claimBalances: new Map(),
  relationships: new Map(),
  protocolEvents: new Map(),
  poolAccounts: new Map(),
  pool: {
    realizedGrossFinancingReturnAtomic: "0",
    realizedLpYieldAtomic: "0",
    realizedOriginationFeesAtomic: "0",
    realizedProtocolYieldFeesAtomic: "0",
    refundedQuotedFeesAtomic: "0",
    realizedLossAtomic: "0",
    outstandingAdvanceCostBasisAtomic: "0",
    outstandingQuotedFeesAtomic: "0",
    source: "indexed",
  },
  treasuryFees: {},
});

const text = (value: unknown) => String(value ?? "");
const eventKey = (event: IndexedEvent) =>
  `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`;

function bundleFor(state: Projection, bundleId: string) {
  const existing = state.bundles.get(bundleId) ?? {
    id: bundleId,
    onchainBundleId: bundleId,
    status: "UNKNOWN",
    eventHistory: [],
    source: "indexed",
  };
  state.bundles.set(bundleId, existing);
  return existing;
}

function applyClaimTransfer(
  state: Projection,
  claimId: string,
  from: string,
  to: string,
  value: bigint,
) {
  const balances = state.claimBalances.get(claimId) ?? new Map<string, bigint>();
  const normalizedFrom = from.toLowerCase();
  const normalizedTo = to.toLowerCase();
  if (normalizedFrom !== "0x0000000000000000000000000000000000000000") {
    balances.set(normalizedFrom, (balances.get(normalizedFrom) ?? 0n) - value);
  }
  if (normalizedTo !== "0x0000000000000000000000000000000000000000") {
    balances.set(normalizedTo, (balances.get(normalizedTo) ?? 0n) + value);
  }
  state.claimBalances.set(claimId, balances);
  const claim = state.claims.get(claimId);
  if (claim) {
    claim.balances = Object.fromEntries(
      [...balances].map(([owner, balance]) => [owner, balance.toString()]),
    );
  }
}

export function applyIndexedEvent(state: Projection, event: IndexedEvent): Projection {
  const key = eventKey(event);
  if (event.removed || state.applied.has(key)) return state;
  state.applied.add(key);
  const payload = event.payload;
  const bundleId = text(payload.bundleId);
  const historyItem = {
    eventName: event.eventName,
    blockNumber: event.blockNumber.toString(),
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
  };
  state.protocolEvents.set(key, { ...historyItem, payload, source: "indexed" });

  if (bundleId) {
    const bundle = bundleFor(state, bundleId);
    const history = bundle.eventHistory as Array<Record<string, unknown>>;
    history.push(historyItem);
    if (event.eventName === "BundleOpened") {
      Object.assign(bundle, {
        status: "ACTIVE",
        positionWallet: payload.positionWallet,
        relationshipDefinitionHash: payload.relationshipHash,
        openedTransactionHash: event.transactionHash,
      });
    } else if (event.eventName === "PositionsEscrowed") {
      Object.assign(bundle, {
        conditionIds: payload.conditionIds,
        tokenIds: payload.tokenIds,
        amounts: payload.amounts,
      });
    } else if (event.eventName === "AdvanceFunded") {
      Object.assign(bundle, {
        grossAdvanceAtomic: text(payload.grossAdvance),
        quotedOriginationFeeAtomic: text(payload.originationFee),
        netAdvanceAtomic: text(payload.netAdvance),
      });
      state.pool.outstandingAdvanceCostBasisAtomic = (
        BigInt(text(state.pool.outstandingAdvanceCostBasisAtomic))
        + BigInt(text(payload.grossAdvance))
      ).toString();
      state.pool.outstandingQuotedFeesAtomic = (
        BigInt(text(state.pool.outstandingQuotedFeesAtomic))
        + BigInt(text(payload.originationFee))
      ).toString();
    } else if (event.eventName === "ClaimsMinted") {
      Object.assign(bundle, {
        principalAmountAtomic: text(payload.principalSupply),
        residualSupplyAtomic: text(payload.residualSupply),
      });
      for (const [claimType, supply] of [
        ["PRINCIPAL", payload.principalSupply],
        ["RESIDUAL", payload.residualSupply],
      ]) {
        const claimId = BigInt(
          keccak256(
            encodeAbiParameters(
              [{ type: "uint256" }, { type: "uint8" }],
              [BigInt(bundleId), claimType === "PRINCIPAL" ? 1 : 2],
            ),
          ),
        ).toString();
        state.claims.set(claimId, {
          tokenId: claimId,
          bundleId,
          claimType,
          supplyAtomic: text(supply),
          source: "indexed",
          balances: Object.fromEntries(
            [...(state.claimBalances.get(claimId) ?? new Map())].map(([owner, balance]) => [
              owner,
              balance.toString(),
            ]),
          ),
        });
      }
    } else if (event.eventName === "SettlementStarted") {
      bundle.status = "RESOLUTION_PENDING";
    } else if (event.eventName === "PositionsRedeemed") {
      bundle.settlementProceedsAtomic = text(payload.proceeds);
    } else if (event.eventName === "BundleSettled") {
      Object.assign(bundle, {
        status: "SETTLED",
        principalAllocationAtomic: text(payload.principalAllocation),
        residualAllocationAtomic: text(payload.residualAllocation),
      });
    } else if (event.eventName === "BundleShortfall") {
      Object.assign(bundle, {
        status: "SHORTFALL",
        shortfallAtomic: (
          BigInt(text(payload.principal)) - BigInt(text(payload.proceeds))
        ).toString(),
      });
    } else if (event.eventName === "PrincipalClaimed" || event.eventName === "ResidualClaimed") {
      const kind = event.eventName === "PrincipalClaimed" ? "principal" : "residual";
      bundle[`${kind}ClaimedAtomic`] = text(payload.payout);
    } else if (event.eventName === "PrincipalSettled") {
      const cost = BigInt(text(bundle.grossAdvanceAtomic || "0"));
      const received = BigInt(text(payload.principalReceived));
      state.pool.realizedGrossFinancingReturnAtomic = (
        BigInt(text(state.pool.realizedGrossFinancingReturnAtomic))
        + BigInt(text(payload.grossFinancingReturn))
      ).toString();
      state.pool.realizedLpYieldAtomic = (
        BigInt(text(state.pool.realizedLpYieldAtomic))
        + BigInt(text(payload.realizedLpYield))
      ).toString();
      state.pool.realizedProtocolYieldFeesAtomic = (
        BigInt(text(state.pool.realizedProtocolYieldFeesAtomic))
        + BigInt(text(payload.protocolFee))
      ).toString();
      if (received < cost) {
        state.pool.realizedLossAtomic = (
          BigInt(text(state.pool.realizedLossAtomic)) + cost - received
        ).toString();
      }
      state.pool.outstandingAdvanceCostBasisAtomic = (
        BigInt(text(state.pool.outstandingAdvanceCostBasisAtomic)) - cost
      ).toString();
      state.pool.outstandingQuotedFeesAtomic = (
        BigInt(text(state.pool.outstandingQuotedFeesAtomic))
        - BigInt(text(bundle.quotedOriginationFeeAtomic || "0"))
      ).toString();
    } else if (event.eventName === "OriginationFeeSettled") {
      bundle.realizedOriginationFeeAtomic = text(payload.realizedFee);
      bundle.refundedOriginationFeeAtomic = text(payload.refundedFee);
      state.pool.realizedOriginationFeesAtomic = (
        BigInt(text(state.pool.realizedOriginationFeesAtomic))
        + BigInt(text(payload.realizedFee))
      ).toString();
      state.pool.refundedQuotedFeesAtomic = (
        BigInt(text(state.pool.refundedQuotedFeesAtomic))
        + BigInt(text(payload.refundedFee))
      ).toString();
    }
  }

  if (event.eventName === "FeeRecorded") {
    const source = text(payload.source);
    state.treasuryFees[source] =
      (state.treasuryFees[source] ?? 0n) + BigInt(text(payload.amount));
  } else if (event.eventName === "RelationshipRegistered") {
    const hash = text(payload.definitionHash);
    state.relationships.set(hash, {
      id: hash,
      canonicalDefinitionHash: hash,
      version: Number(payload.version),
      resolutionRulesHash: payload.ruleDocumentHash,
      status: "APPROVED",
      source: "indexed",
    });
  } else if (event.eventName === "RelationshipStatusChanged") {
    const hash = text(payload.definitionHash);
    const relationship = state.relationships.get(hash) ?? { id: hash };
    relationship.status = ["NONE", "APPROVED", "SUSPENDED", "RETIRED"][Number(payload.status)] ?? "UNKNOWN";
    state.relationships.set(hash, relationship);
  } else if (event.eventName === "TransferSingle") {
    applyClaimTransfer(
      state,
      text(payload.id),
      text(payload.from),
      text(payload.to),
      BigInt(text(payload.value)),
    );
  } else if (event.eventName === "TransferBatch") {
    const ids = (payload.ids as unknown[] | undefined) ?? [];
    const values = (payload.values as unknown[] | undefined) ?? [];
    for (let index = 0; index < ids.length; index += 1) {
      applyClaimTransfer(
        state,
        text(ids[index]),
        text(payload.from),
        text(payload.to),
        BigInt(text(values[index])),
      );
    }
  } else if (event.eventName === "Deposit" || event.eventName === "Withdraw") {
    state.pool.lastShareEvent = historyItem;
    const owner = text(payload.owner).toLowerCase();
    const current = state.poolAccounts.get(owner) ?? {
      address: owner,
      sharesAtomic: "0",
      availableWithdrawalAtomic: "0",
      source: "indexed",
    };
    const priorShares = BigInt(text(current.sharesAtomic));
    const shareDelta = BigInt(text(payload.shares));
    current.sharesAtomic = (
      event.eventName === "Deposit"
        ? priorShares + shareDelta
        : priorShares - shareDelta
    ).toString();
    current.lastShareEvent = historyItem;
    state.poolAccounts.set(owner, current);
  } else if (
    event.eventName === "LimitsUpdated"
    || event.eventName === "QuoteSignerUpdated"
    || event.eventName === "OriginationsPauseUpdated"
    || event.eventName === "Paused"
    || event.eventName === "Unpaused"
  ) {
    state.pool.lastRiskPolicyEvent = historyItem;
  }
  return state;
}

export function rebuildProjection(events: IndexedEvent[]): Projection {
  return events
    .filter((event) => !event.removed)
    .sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.logIndex - right.logIndex
        : left.blockNumber < right.blockNumber ? -1 : 1
    )
    .reduce(applyIndexedEvent, emptyProjection());
}

export function dueDeadLetters<T extends { nextRetryAt?: number; retryCount: number }>(
  records: T[],
  now: number,
) {
  return records.filter((record) =>
    record.retryCount < 10 && (record.nextRetryAt ?? 0) <= now
  );
}

export function reconcileProjection(
  projection: Projection,
  expected: { bundles: number; claims: number },
) {
  return {
    matches:
      projection.bundles.size === expected.bundles
      && projection.claims.size === expected.claims,
    indexedBundles: projection.bundles.size,
    indexedClaims: projection.claims.size,
    expected,
  };
}
import { encodeAbiParameters, keccak256 } from "viem";
