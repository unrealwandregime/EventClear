"use client";

import { useEffect, useState } from "react";
import {
  apiFetch,
  formatPusd,
  idempotencyKey,
  waitForIndexedEvents,
} from "../../lib/api";
import { provider, submitAndWait } from "../../lib/wallet";
import type {
  AnalysisRecord,
  Hex,
  PreparedTransaction,
  PublicConfig,
  QuoteRecord,
  TransactionStage,
} from "../../lib/types";
import { TransactionTimeline } from "../transactions/TransactionTimeline";

const confirmations = [
  "I reviewed the market resolution rules.",
  "I understand the relationship model may be incorrect despite solver verification.",
  "I authorize the exact listed positions to be escrowed.",
  "I understand EventClear is unaudited.",
];

export function LifecycleDrawer({
  analysis,
  wallet,
  session,
  config,
  stages,
  recordStage,
  onClose,
}: {
  analysis: AnalysisRecord;
  wallet: Hex;
  session: string;
  config: PublicConfig;
  stages: TransactionStage[];
  recordStage(stage: TransactionStage): void;
  onClose(): void;
}) {
  const [quote, setQuote] = useState<QuoteRecord | null>(null);
  const [accepted, setAccepted] = useState<boolean[]>(confirmations.map(() => false));
  const [status, setStatus] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!quote) return;
    const update = () =>
      setSecondsLeft(Math.max(0, Number(quote.quote.expiry) - Math.floor(Date.now() / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  function downloadArtifact() {
    const blob = new Blob([JSON.stringify(analysis.artifact, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eventclear-proof-${analysis.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function verifyArtifact() {
    setStatus("Verifying the canonical proof artifact…");
    const result = await apiFetch<{ valid: boolean }>(
      `/analysis/${analysis.id}/verify`,
      { method: "POST" },
    );
    setStatus(result.valid ? "Proof artifact reproduced successfully." : "Proof verification failed.");
  }

  async function requestQuote() {
    try {
      setStatus("Revalidating positions, markets, pool and risk limits…");
      const result = await apiFetch<QuoteRecord>(
        "/quotes",
        {
          method: "POST",
          body: JSON.stringify({
            accountWallet: wallet,
            borrower: wallet,
            positionWallet: wallet,
            chainId: config.chainId,
            solverRequest: analysis.artifact.request,
          }),
        },
        session,
      );
      setQuote(result);
      setStatus("Live quote signed after preflight validation.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "QUOTE_REQUEST_FAILED");
    }
  }

  async function prepareAndSubmit() {
    if (!quote || !accepted.every(Boolean)) return;
    const walletProvider = provider();
    if (!walletProvider) return;
    try {
      recordStage({ action: "SIGNATURE_REQUESTED", status: "requested", updatedAt: Date.now() });
      const authorizationSignature = await walletProvider.request({
        method: "eth_signTypedData_v4",
        params: [wallet, JSON.stringify(quote.walletAuthorization.typedData)],
      }) as Hex;
      let prepared = await apiFetch<PreparedTransaction>(
        "/bundles/open/prepare",
        {
          method: "POST",
          body: JSON.stringify({
            quoteId: quote.id,
            walletAuthorizationSignature: authorizationSignature,
          }),
        },
        session,
        idempotencyKey("open"),
      );
      if (prepared.action === "APPROVE_POSITIONS") {
        recordStage({ action: "APPROVAL_SUBMITTED", status: "submitted", updatedAt: Date.now() });
        const approvalHash = await submitAndWait(wallet, prepared, config);
        recordStage({ action: "APPROVAL_CONFIRMED", hash: approvalHash, status: "confirmed", updatedAt: Date.now() });
        prepared = await apiFetch<PreparedTransaction>(
          "/bundles/open/prepare",
          {
            method: "POST",
            body: JSON.stringify({
              quoteId: quote.id,
              walletAuthorizationSignature: authorizationSignature,
            }),
          },
          session,
          idempotencyKey("open-after-approval"),
        );
      }
      if (prepared.action !== "OPEN_BUNDLE") throw new Error("OPEN_BUNDLE_NOT_READY");
      recordStage({ action: "BUNDLE_SUBMITTED", status: "submitted", updatedAt: Date.now() });
      const bundleHash = await submitAndWait(wallet, prepared, config);
      recordStage({ action: "BUNDLE_CONFIRMED", hash: bundleHash, status: "confirmed", updatedAt: Date.now() });
      recordStage({ action: "INDEXER_CONFIRMATION_PENDING", hash: bundleHash, status: "submitted", updatedAt: Date.now() });
      setStatus("Bundle confirmed onchain. Awaiting indexed positions, advance and claims.");
      await waitForIndexedEvents(bundleHash, [
        "PositionsEscrowed",
        "AdvanceFunded",
        "ClaimsMinted",
      ]);
      recordStage({ action: "POSITIONS_ESCROWED", hash: bundleHash, status: "confirmed", updatedAt: Date.now() });
      recordStage({ action: "ADVANCE_FUNDED", hash: bundleHash, status: "confirmed", updatedAt: Date.now() });
      recordStage({ action: "CLAIMS_MINTED", hash: bundleHash, status: "confirmed", updatedAt: Date.now() });
      recordStage({ action: "INDEXER_CONFIRMED", hash: bundleHash, status: "confirmed", updatedAt: Date.now() });
      setStatus("Bundle lifecycle confirmed by the canonical indexer.");
    } catch (error) {
      recordStage({ action: "LIFECYCLE_FAILED", status: "failed", updatedAt: Date.now() });
      setStatus(error instanceof Error ? error.message : "BUNDLE_OPEN_FAILED");
    }
  }

  const solver = analysis.solverResult;
  const maximumResidual = BigInt(solver.maximumPayoutAtomic) - BigInt(solver.guaranteedFloorAtomic);

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <section className="quote lifecycle-drawer">
        <div className="quote-body">
          <p className="eyebrow">Canonical solver analysis</p>
          <h2 id="analysis-title">{analysis.relationship.id}</h2>
          <p>
            {solver.solverVersion} · relationship v{analysis.relationship.version} ·{" "}
            <code>{solver.artifactHash.slice(0, 12)}…</code>
          </p>
          <div className="quote-grid">
            <div><label>Guaranteed floor</label><strong>{formatPusd(solver.guaranteedFloorAtomic)} pUSD</strong></div>
            <div><label>Maximum payout</label><strong>{formatPusd(solver.maximumPayoutAtomic)} pUSD</strong></div>
            <div><label>Maximum residual</label><strong>{formatPusd(maximumResidual.toString())} pUSD</strong></div>
            <div><label>Resolution date</label><strong>{new Date(analysis.relationship.latestResolutionTimestamp * 1000).toLocaleString()}</strong></div>
            <div><label>Definition hash</label><code>{solver.definitionHash.slice(0, 14)}…</code></div>
            <div><label>Rule hash</label><code>{analysis.relationship.ruleDocumentHash.slice(0, 14)}…</code></div>
          </div>
          <div className="worlds">
            <div className="world-row"><span>Generated world</span><span>Payout</span><span>Witness</span></div>
            {solver.terminalWorlds.map((world) => (
              <div className="world-row" key={world.worldId}>
                <span>{world.worldId}</span>
                <span>{formatPusd(world.totalPayoutAtomic)} pUSD</span>
                <span className="floor">
                  {solver.minimumWitnessWorlds.some((item) => item.worldId === world.worldId)
                    ? "Minimum"
                    : solver.maximumWitnessWorlds.some((item) => item.worldId === world.worldId)
                      ? "Maximum"
                      : "—"}
                </span>
              </div>
            ))}
          </div>
          <div className="quote-actions inline-actions">
            <button className="ghost" onClick={downloadArtifact}>Download proof artifact</button>
            <button className="ghost" onClick={verifyArtifact}>Verify proof artifact</button>
            {!quote && (
              <button className="analyze" disabled={!config.mainnetExecution} onClick={requestQuote}>
                {config.mainnetExecution ? "Request live quote" : "Execution read-only"}
              </button>
            )}
          </div>
          {quote && (
            <>
              <div className="quote-grid quote-live">
                <div><label>Gross advance</label><strong>{formatPusd(quote.quote.grossAdvance)} pUSD</strong></div>
                <div><label>Quoted fee</label><strong>{formatPusd(quote.quote.originationFee)} pUSD</strong></div>
                <div><label>Net advance</label><strong>{formatPusd(quote.quote.netAdvance)} pUSD</strong></div>
                <div><label>Principal claim</label><strong>{formatPusd(quote.quote.principalAmount)} pUSD</strong></div>
                <div><label>Quote expiry</label><strong>{secondsLeft ?? "—"}s</strong></div>
                <div><label>Risk signer</label><code>{quote.riskSigner.slice(0, 12)}…</code></div>
                <div><label>Borrower / position wallet</label><code>{quote.quote.borrower.slice(0, 12)}…</code></div>
                <div><label>Vault / pool / chain</label><code>{quote.quote.vault.slice(0, 8)}… / {quote.quote.fundingPool.slice(0, 8)}… / {quote.quote.chainId}</code></div>
              </div>
              <div className="confirmations">
                {confirmations.map((label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={accepted[index]}
                      onChange={(event) =>
                        setAccepted((current) => current.map((value, item) =>
                          item === index ? event.target.checked : value
                        ))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button
                className="analyze wide"
                disabled={!accepted.every(Boolean) || secondsLeft === 0}
                onClick={prepareAndSubmit}
              >
                Sign exact wallet authorization and continue
              </button>
            </>
          )}
          <TransactionTimeline stages={stages} chainId={config.chainId} />
          {status && <p className="form-note" role="status">{status}</p>}
        </div>
        <div className="quote-actions">
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
