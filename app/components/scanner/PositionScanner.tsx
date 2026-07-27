"use client";

import type {
  PositionRecord,
  RelationshipRecord,
  SelectedLeg,
} from "../../lib/types";
import { formatPusd } from "../../lib/api";

type Props = {
  positions: PositionRecord[];
  relationship?: RelationshipRecord;
  selected: Record<string, string>;
  onSelectionChange(tokenId: string, amountAtomic?: string): void;
  onAnalyze(legs: SelectedLeg[]): void;
  busy: boolean;
};

export function PositionScanner({
  positions,
  relationship,
  selected,
  onSelectionChange,
  onAnalyze,
  busy,
}: Props) {
  const reviewedTokens = new Set(
    relationship?.reviewedMarkets?.flatMap((market) =>
      Object.values(market.tokenIds),
    ) ?? [],
  );
  const legs = positions
    .filter((position) => selected[position.tokenId])
    .map((position) => ({
      ...position,
      selectedAmountAtomic: selected[position.tokenId],
    }));

  return (
    <section className="workspace-grid">
      <div className="panel">
        <div className="panel-head">
          <h2>Indexed wallet positions</h2>
          <span>Exact quantities · reviewed compatibility</span>
        </div>
        <div className="data-table">
          <div className="data-row data-head">
            <span>Include</span><span>Position</span><span>Quantity</span>
            <span>Value</span><span>Rule match</span>
          </div>
          {positions.map((position) => {
            const compatible = reviewedTokens.has(position.tokenId);
            const checked = selected[position.tokenId] !== undefined;
            return (
              <label className="data-row" key={position.tokenId}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!compatible}
                  onChange={(event) =>
                    onSelectionChange(
                      position.tokenId,
                      event.target.checked ? position.amountAtomic : undefined,
                    )
                  }
                />
                <span>{position.title ?? `${position.outcome} token ${position.tokenId}`}</span>
                <input
                  className="quantity-input"
                  aria-label={`Quantity for ${position.title ?? position.tokenId}`}
                  disabled={!checked}
                  value={selected[position.tokenId] ?? position.amountAtomic}
                  onChange={(event) => onSelectionChange(position.tokenId, event.target.value)}
                />
                <span>{formatPusd(position.currentValueAtomic)} pUSD</span>
                <em className={compatible ? "" : "warn"}>
                  {compatible ? "Reviewed" : "Not eligible"}
                </em>
              </label>
            );
          })}
          {positions.length === 0 && (
            <div className="data-row">
              <span>—</span><span>No indexed positions</span><span>—</span>
              <span>—</span><em>Unavailable</em>
            </div>
          )}
        </div>
      </div>
      <div className="panel solver-card">
        <div className="panel-head">
          <h2>Bundle analysis</h2><span>{legs.length} exact legs</span>
        </div>
        <div className="solver-body">
          <p className="eyebrow">
            {relationship ? `Relationship v${relationship.version}` : "No reviewed relationship"}
          </p>
          <dl>
            {legs.map((leg) => (
              <div key={leg.tokenId}>
                <dt>{leg.outcome} · {leg.tokenId}</dt>
                <dd>{formatPusd(leg.selectedAmountAtomic)} shares</dd>
              </div>
            ))}
          </dl>
          <button
            className="analyze wide"
            disabled={busy || !relationship || legs.length === 0 || legs.some((leg) =>
              !/^\d+$/.test(leg.selectedAmountAtomic)
              || BigInt(leg.selectedAmountAtomic) <= 0n
              || BigInt(leg.selectedAmountAtomic) > BigInt(leg.amountAtomic)
            )}
            onClick={() => onAnalyze(legs)}
          >
            {busy ? "Analyzing…" : "Submit exact bundle for analysis"}
          </button>
          <small className="form-note">
            The guaranteed floor appears only after the API solver returns it.
          </small>
        </div>
      </div>
    </section>
  );
}
