"use client";

import { useEffect, useState } from "react";
import { apiFetch, formatPusd } from "../../lib/api";

type BundleDetailRecord = {
  id: string;
  status: string;
  principalAmountAtomic?: string;
  grossAdvanceAtomic?: string;
  netAdvanceAtomic?: string;
  settlementProceedsAtomic?: string;
  principalAllocationAtomic?: string;
  residualAllocationAtomic?: string;
  shortfallAtomic?: string;
  relationshipId?: string;
  relationshipVersion?: number;
  artifactHash?: string;
  conditionsResolved?: boolean;
  openedTransactionHash?: string;
  settledTransactionHash?: string;
  legs?: Array<{
    conditionId: string;
    tokenId: string;
    outcome?: string;
    amountAtomic: string;
  }>;
  claims?: Array<{
    tokenId: string;
    claimType: string;
    holderBalanceAtomic?: string;
  }>;
  events?: Array<{
    eventName?: string;
    blockNumber?: string | number;
    transactionHash?: string;
  }>;
};

export function BundleDetail({ bundleId }: { bundleId: string }) {
  const [bundle, setBundle] = useState<BundleDetailRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<BundleDetailRecord>(`/bundles/${encodeURIComponent(bundleId)}`)
      .then(setBundle)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "BUNDLE_UNAVAILABLE")
      );
  }, [bundleId]);

  if (error) return <p className="wallet-error">{error}</p>;
  if (!bundle) return <p className="form-note">Loading verified indexed bundle state…</p>;

  const values = [
    ["Status", bundle.status],
    ["Principal", `${formatPusd(bundle.principalAmountAtomic)} pUSD`],
    ["Gross advance", `${formatPusd(bundle.grossAdvanceAtomic)} pUSD`],
    ["Net advance", `${formatPusd(bundle.netAdvanceAtomic)} pUSD`],
    ["Relationship", bundle.relationshipId
      ? `${bundle.relationshipId} v${bundle.relationshipVersion ?? "—"}`
      : "Unavailable"],
    ["Artifact hash", bundle.artifactHash ?? "Unavailable"],
    ["Resolution state", bundle.conditionsResolved ? "Resolved" : "Unresolved"],
    ["Settlement proceeds", `${formatPusd(bundle.settlementProceedsAtomic)} pUSD`],
    ["Principal allocation", `${formatPusd(bundle.principalAllocationAtomic)} pUSD`],
    ["Residual allocation", `${formatPusd(bundle.residualAllocationAtomic)} pUSD`],
    ["Shortfall", `${formatPusd(bundle.shortfallAtomic)} pUSD`],
  ];

  return (
    <>
      <div className="quote-grid detail-grid">
        {values.map(([label, value]) => (
          <div key={label}><label>{label}</label><strong>{value}</strong></div>
        ))}
      </div>
      <section className="panel detail-section">
        <div className="panel-head"><h2>Escrowed legs</h2><span>Exact indexed quantities</span></div>
        <div className="data-table">
          {(bundle.legs ?? []).map((leg) => (
            <div className="data-row detail-row" key={`${leg.conditionId}:${leg.tokenId}`}>
              <code>{leg.conditionId}</code><b>{leg.tokenId}</b><em>{leg.outcome ?? "—"}</em>
              <span>{leg.amountAtomic} units</span>
            </div>
          ))}
          {!bundle.legs?.length && <p className="form-note">No indexed legs available.</p>}
        </div>
      </section>
      <section className="panel detail-section">
        <div className="panel-head"><h2>Claim balances</h2><span>Principal and residual</span></div>
        {(bundle.claims ?? []).map((claim) => (
          <div className="data-row detail-row" key={claim.tokenId}>
            <b>{claim.tokenId}</b><em>{claim.claimType}</em>
            <span>{claim.holderBalanceAtomic ?? "0"} claim units</span>
          </div>
        ))}
        {!bundle.claims?.length && <p className="form-note">No indexed claims available.</p>}
      </section>
      <section className="panel detail-section">
        <div className="panel-head"><h2>Event history</h2><span>Canonical chain ordering</span></div>
        {(bundle.events ?? []).map((event, index) => (
          <div className="data-row detail-row" key={`${event.transactionHash}:${index}`}>
            <b>{event.eventName ?? "Protocol event"}</b>
            <span>Block {event.blockNumber ?? "Unavailable"}</span>
            <code>{event.transactionHash ?? "Unavailable"}</code>
          </div>
        ))}
        {!bundle.events?.length && <p className="form-note">No indexed event history available.</p>}
      </section>
    </>
  );
}
