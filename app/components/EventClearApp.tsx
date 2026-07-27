"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
} from "viem";
import { PositionScanner } from "./scanner/PositionScanner";
import { LifecycleDrawer } from "./analysis/LifecycleDrawer";
import { TransactionTimeline } from "./transactions/TransactionTimeline";
import { usePersistentTransactions } from "../hooks/usePersistentTransactions";
import {
  apiFetch,
  formatPusd,
  idempotencyKey,
  waitForIndexedEvents,
} from "../lib/api";
import {
  connectAndAuthenticate,
  provider,
  submitAndWait,
} from "../lib/wallet";
import type {
  AnalysisRecord,
  Hex,
  PositionRecord,
  PreparedTransaction,
  PublicConfig,
  RelationshipRecord,
  SelectedLeg,
} from "../lib/types";

type ProtocolMetrics = {
  available: boolean;
  activeBundles?: number;
  guaranteedFloorEscrowedAtomic?: string;
  netAdvancesAtomic?: string;
  approvedRelationships?: number;
};

type BundleRecord = {
  id: string;
  status: string;
  principalAmountAtomic: string;
  grossAdvanceAtomic?: string;
  netAdvanceAtomic?: string;
  settlementProceedsAtomic?: string;
  principalAllocationAtomic?: string;
  residualAllocationAtomic?: string;
  conditionsResolved?: boolean;
};

type ClaimRecord = {
  tokenId: string;
  bundleId: string;
  claimType: string;
  holderBalanceAtomic?: string;
  holderAddress?: string;
  balances?: Record<string, string>;
};

type PoolRecord = {
  totalAssetsAtomic: string;
  liquidAtomic: string;
  outstandingAdvanceCostBasisAtomic: string;
  outstandingQuotedFeesAtomic: string;
  realizedYieldAtomic: string;
  realizedLossAtomic: string;
  utilizationBps: number;
};

type WalletCapability = {
  signerAddress: Hex;
  positionWallet: Hex;
  walletType: string;
  executionSupported: boolean;
};

type PoolAccount = {
  sharesAtomic: string;
  availableWithdrawalAtomic: string;
  allowlisted: boolean;
};

const erc1155ReadAbi = parseAbi([
  "function isApprovedForAll(address account, address operator) view returns (bool)",
]);

const navItems = ["Overview", "Scanner", "Bundles", "Claims", "Pool", "Registry"];

function parsePusdAtomic(value: string) {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,6}$/.test(fraction)) {
    throw new Error("INVALID_PUSD_AMOUNT");
  }
  const amount = BigInt(whole) * 1_000_000n
    + BigInt(fraction.padEnd(6, "0") || "0");
  if (amount <= 0n) throw new Error("INVALID_PUSD_AMOUNT");
  return amount;
}

export function EventClearApp() {
  const [active, setActive] = useState("Overview");
  const [wallet, setWallet] = useState<Hex | "">("");
  const [session, setSession] = useState("");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [capability, setCapability] = useState<WalletCapability | null>(null);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([]);
  const [bundles, setBundles] = useState<BundleRecord[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [metrics, setMetrics] = useState<ProtocolMetrics | null>(null);
  const [pool, setPool] = useState<PoolRecord | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [depositAmount, setDepositAmount] = useState("100");
  const [withdrawAmount, setWithdrawAmount] = useState("0");
  const [claimAmounts, setClaimAmounts] = useState<Record<string, string>>({});
  const [poolAccount, setPoolAccount] = useState<PoolAccount | null>(null);
  const [pusdBalance, setPusdBalance] = useState<string>();
  const [positionApproval, setPositionApproval] = useState<boolean>();
  const { stages, record } = usePersistentTransactions();
  const recoveringTransactions = useRef(new Set<string>());

  const approvedRelationship = useMemo(
    () => relationships.find((item) =>
      item.status === "APPROVED" && item.relationshipType === "CRYPTO_THRESHOLD_V1"
    ),
    [relationships],
  );

  useEffect(() => {
    document.documentElement.dataset.eventclearHydrated = "true";
    return () => {
      delete document.documentElement.dataset.eventclearHydrated;
    };
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch<PublicConfig>("/config/public"),
      apiFetch<ProtocolMetrics>("/protocol/metrics"),
      apiFetch<{ data: RelationshipRecord[] }>("/relationships"),
      apiFetch<{ data: BundleRecord[] }>("/bundles"),
      apiFetch<{ data: ClaimRecord[] }>("/claims"),
      apiFetch<PoolRecord>("/pool").catch(() => null),
    ])
      .then(([publicConfig, protocolMetrics, relationshipData, bundleData, claimData, poolData]) => {
        setConfig(publicConfig);
        setMetrics(protocolMetrics);
        setRelationships(relationshipData.data);
        setBundles(bundleData.data);
        setClaims(claimData.data);
        setPool(poolData);
        const savedSession = localStorage.getItem("eventclear.session");
        const savedWallet = localStorage.getItem("eventclear.wallet") as Hex | null;
        if (savedSession && savedWallet) {
          apiFetch<{ address: Hex }>("/auth/session", {}, savedSession)
            .then((restored) => {
              if (restored.address.toLowerCase() !== savedWallet.toLowerCase()) {
                throw new Error("SIWE_ADDRESS_MISMATCH");
              }
              setSession(savedSession);
              setWallet(savedWallet);
            })
            .catch(() => {
              localStorage.removeItem("eventclear.session");
              localStorage.removeItem("eventclear.wallet");
            });
        }
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "PROTOCOL_DATA_UNAVAILABLE")
      );
  }, []);

  useEffect(() => {
    if (!wallet) return;
    Promise.all([
      apiFetch<WalletCapability>(`/wallets/${wallet}`),
      apiFetch<{ positions: PositionRecord[] }>(`/wallets/${wallet}/positions`),
      apiFetch<{ data: ClaimRecord[] }>("/claims"),
      apiFetch<PoolAccount>(`/pool/account/${wallet}`).catch(() => null),
    ])
      .then(async ([walletCapability, positionData, claimData, account]) => {
        setCapability(walletCapability);
        setPositions(positionData.positions);
        setClaims(claimData.data.map((item) => ({
          ...item,
          holderBalanceAtomic:
            item.balances?.[wallet.toLowerCase()]
            ?? (item.holderAddress?.toLowerCase() === wallet.toLowerCase()
              ? item.holderBalanceAtomic
              : "0"),
        })));
        setPoolAccount(account);
        if (account) {
          setWithdrawAmount(formatPusd(account.availableWithdrawalAtomic));
        }
        const walletProvider = provider();
        if (!walletProvider || !config) return;
        try {
          const balanceCall = encodeFunctionData({
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [wallet],
          });
          const approvalCall = encodeFunctionData({
            abi: erc1155ReadAbi,
            functionName: "isApprovedForAll",
            args: [wallet, config.vaultAddress],
          });
          const [balanceResult, approvalResult] = await Promise.all([
            walletProvider.request({
              method: "eth_call",
              params: [{ to: config.collateralTokenAddress, data: balanceCall }, "latest"],
            }),
            walletProvider.request({
              method: "eth_call",
              params: [{ to: config.conditionalTokensAddress, data: approvalCall }, "latest"],
            }),
          ]) as [Hex, Hex];
          setPusdBalance(decodeFunctionResult({
            abi: erc20Abi,
            functionName: "balanceOf",
            data: balanceResult,
          }).toString());
          setPositionApproval(decodeFunctionResult({
            abi: erc1155ReadAbi,
            functionName: "isApprovedForAll",
            data: approvalResult,
          }));
        } catch {
          setPusdBalance(undefined);
          setPositionApproval(undefined);
        }
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "WALLET_DATA_UNAVAILABLE")
      );
  }, [wallet, config]);

  useEffect(() => {
    for (const stage of stages) {
      if (
        stage.status !== "submitted"
        || !stage.hash
        || recoveringTransactions.current.has(stage.action)
      ) continue;
      const expected =
        stage.action === "INDEXER_CONFIRMATION_PENDING"
          ? ["PositionsEscrowed", "AdvanceFunded", "ClaimsMinted"]
          : stage.action.includes("POOL_DEPOSIT") ? ["Deposit"]
            : stage.action.includes("POOL_WITHDRAWAL") ? ["Withdraw"]
              : stage.action.includes("SETTLE_") ? ["PositionsRedeemed"]
                : stage.action.includes("REDEEM_") ? [] : null;
      if (expected === null || expected.length === 0) continue;
      recoveringTransactions.current.add(stage.action);
      void waitForIndexedEvents(stage.hash, expected)
        .then(() => {
          record({ ...stage, status: "confirmed", updatedAt: Date.now() });
          setMessage(`${stage.action.replaceAll("_", " ")} recovered from indexed state.`);
        })
        .catch(() => {
          recoveringTransactions.current.delete(stage.action);
        });
    }
  }, [stages, record]);

  async function connect() {
    if (!config) return;
    try {
      setMessage("Verify the chain and sign the SIWE session request.");
      const connected = await connectAndAuthenticate(config);
      setWallet(connected.address);
      setSession(connected.session);
      setMessage("Wallet authenticated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "WALLET_CONNECTION_FAILED");
    }
  }

  async function analyze(legs: SelectedLeg[]) {
    if (!wallet || !session || !approvedRelationship || !config) return;
    setBusy(true);
    setMessage("Generating and verifying every terminal world…");
    try {
      const result = await apiFetch<AnalysisRecord>(
        "/analysis",
        {
          method: "POST",
          body: JSON.stringify({
            accountWallet: wallet,
            positionWallet: wallet,
            chainId: config.chainId,
            solverRequest: {
              relationshipDefinitionHash: approvedRelationship.canonicalDefinitionHash,
              definitionVersion: approvedRelationship.version,
              legs: legs.map((leg) => ({
                conditionId: leg.conditionId,
                tokenId: leg.tokenId,
                outcome: leg.outcome,
                amountAtomic: leg.selectedAmountAtomic,
              })),
              payoutModel: {},
            },
          }),
        },
        session,
      );
      setAnalysis(result);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ANALYSIS_FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function executePrepared(
    path: string,
    body: Record<string, string>,
    action: string,
    expectedIndexedEvents: string[],
  ) {
    if (!wallet || !session || !config) return;
    try {
      record({ action, status: "requested", updatedAt: Date.now() });
      const prepared = await apiFetch<PreparedTransaction>(
        path,
        { method: "POST", body: JSON.stringify(body) },
        session,
        idempotencyKey(action.toLowerCase()),
      );
      record({ action, status: "submitted", updatedAt: Date.now() });
      const hash = await submitAndWait(wallet, prepared, config);
      record({ action, hash, status: "confirmed", updatedAt: Date.now() });
      record({ action: `${action}_INDEXER`, hash, status: "submitted", updatedAt: Date.now() });
      await waitForIndexedEvents(
        hash,
        expectedIndexedEvents,
      );
      record({ action: `${action}_INDEXER`, hash, status: "confirmed", updatedAt: Date.now() });
      setMessage(`${action.replaceAll("_", " ")} confirmed by the indexer.`);
    } catch (error) {
      record({ action, status: "failed", updatedAt: Date.now() });
      setMessage(error instanceof Error ? error.message : `${action}_FAILED`);
    }
  }

  async function depositOnchain() {
    if (!wallet || !session || !config) return;
    const walletProvider = provider();
    if (!walletProvider) return;
    try {
      const amount = parsePusdAtomic(depositAmount);
      record({ action: "PUSD_APPROVAL", status: "submitted", updatedAt: Date.now() });
      const approvalHash = await walletProvider.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: config.collateralTokenAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [config.fundingPoolAddress, amount],
          }),
          value: "0x0",
        }],
      }) as Hex;
      for (;;) {
        const receipt = await walletProvider.request({
          method: "eth_getTransactionReceipt",
          params: [approvalHash],
        }) as { status?: string } | null;
        if (receipt) {
          if (receipt.status !== "0x1") throw new Error("PUSD_APPROVAL_REVERTED");
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      record({ action: "PUSD_APPROVAL", hash: approvalHash, status: "confirmed", updatedAt: Date.now() });
      await executePrepared(
        "/pool/prepare-deposit",
        { amountAtomic: amount.toString(), receiver: wallet },
        "POOL_DEPOSIT",
        ["Deposit"],
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "POOL_DEPOSIT_FAILED");
    }
  }

  const statusItems = config ? [
    ["Environment", config.environment],
    ["Data source", config.dataSource],
    ["Execution status", config.executionStatus],
    ["Contract deployment status", config.contractDeploymentStatus],
    ["Indexer status", config.indexerStatus],
    ["Relationship database status", config.relationshipDatabaseStatus],
  ] : [];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><i className="brandmark" /><span>EventClear</span></div>
        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item}
              className={active === item ? "active" : ""}
              onClick={() => setActive(item)}
            >
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="notice">
          <b>Public read-only alpha</b>
          Live Polymarket market and position data are available. EventClear
          capital execution remains disabled pending security review,
          production infrastructure, multisig activation and controlled pilot approval.
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="breadcrumb">Protocol / {active}</div>
          <button className="wallet" onClick={connect}>
            {wallet
              ? `${wallet.slice(0, 6)}…${wallet.slice(-4)} · ${capability?.walletType ?? "wallet"}`
              : "Connect wallet + SIWE"}
          </button>
        </header>

        <div className="content">
          <div className="release-strip">
            <span><i /> Public read-only alpha</span>
            <b>Standard binary markets only · public capital execution disabled</b>
          </div>
          {wallet && config && (
            <section className="wallet-strip" aria-label="Connected wallet capability">
              <div><label>Signer</label><code>{wallet}</code></div>
              <div><label>Position wallet</label><code>{capability?.positionWallet ?? "Unavailable"}</code></div>
              <div><label>Wallet type</label><strong>{capability?.walletType ?? "Unavailable"}</strong></div>
              <div><label>Execution support</label><strong>{capability?.executionSupported ? "Supported" : "Read-only"}</strong></div>
              <div><label>Chain</label><strong>{config.chainId}</strong></div>
              <div><label>pUSD balance</label><strong>{formatPusd(pusdBalance)}</strong></div>
              <div><label>ERC-1155 approval</label><strong>{positionApproval === undefined ? "Unavailable" : positionApproval ? "Approved" : "Required"}</strong></div>
            </section>
          )}
          {message && <p className="wallet-error" role="status">{message}</p>}

          {active === "Overview" && (
            <>
              <div className="hero">
                <div>
                  <p className="eyebrow">Provable collateral compression</p>
                  <h1>Unlock guaranteed value before markets resolve.</h1>
                  <p className="lede">
                    EventClear advances pUSD against the solver-verified minimum
                    payout of reviewed related outcome positions while the
                    borrower retains a residual claim.
                  </p>
                </div>
                <section className="panel status-grid" aria-label="Release status">
                  {statusItems.map(([label, value]) => (
                    <div key={label}><label>{label}</label><strong>{value || "Unavailable"}</strong></div>
                  ))}
                </section>
              </div>
              <div className="metric-grid">
                <div className="metric"><label>Guaranteed collateral</label><strong>{metrics?.available ? formatPusd(metrics.guaranteedFloorEscrowedAtomic) : "Unavailable"}</strong><small>verified pUSD principal</small></div>
                <div className="metric"><label>Capital unlocked</label><strong>{metrics?.available ? formatPusd(metrics.netAdvancesAtomic) : "Unavailable"}</strong><small>verified net advances</small></div>
                <div className="metric"><label>Active bundles</label><strong>{metrics?.available ? metrics.activeBundles : "Unavailable"}</strong><small>indexed protocol state</small></div>
                <div className="metric"><label>Approved relationships</label><strong>{metrics?.available ? metrics.approvedRelationships : "Unavailable"}</strong><small>reviewed definitions</small></div>
              </div>
              <section className="panel">
                <div className="panel-head"><h2>Active bundles</h2><span>Verified indexed state only</span></div>
                <div className="worlds">
                  <div className="world-row"><span>Bundle</span><span>Principal</span><span>Status</span></div>
                  {bundles.filter((item) => item.status === "ACTIVE").map((item) => (
                    <div className="world-row" key={item.id}>
                      <span>{item.id}</span><span>{formatPusd(item.principalAmountAtomic)}</span>
                      <span className="floor">{item.status}</span>
                    </div>
                  ))}
                  {!bundles.some((item) => item.status === "ACTIVE") && (
                    <div className="world-row"><span>No verified active bundle</span><span>—</span><span>Unavailable</span></div>
                  )}
                </div>
              </section>
            </>
          )}

          {active === "Scanner" && (
            <PositionScanner
              positions={positions}
              relationship={approvedRelationship}
              selected={selected}
              busy={busy}
              onSelectionChange={(tokenId, amount) =>
                setSelected((current) => {
                  const next = { ...current };
                  if (amount === undefined) delete next[tokenId];
                  else next[tokenId] = amount;
                  return next;
                })
              }
              onAnalyze={analyze}
            />
          )}

          {active === "Bundles" && (
            <section className="panel">
              <div className="panel-head"><h2>Bundle ledger</h2><span>Indexer-backed state</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Bundle</span><span>Status</span><span>Principal</span><span>Advance</span><span>Action</span></div>
                {bundles.map((item) => (
                  <div className="data-row" key={item.id}>
                    <b><a className="bundle-link" href={`/bundles/${item.id}`}>{item.id}</a></b>
                    <em className={item.status === "SHORTFALL" ? "warn" : ""}>{item.status}</em>
                    <span>{formatPusd(item.principalAmountAtomic)} pUSD</span>
                    <span>{formatPusd(item.grossAdvanceAtomic)} pUSD</span>
                    <button
                      className="ghost"
                      disabled={!session || !item.conditionsResolved || !config?.mainnetExecution}
                      onClick={() => executePrepared(
                        `/bundles/${item.id}/prepare-settlement`,
                        {},
                        `SETTLE_${item.id}`,
                        ["PositionsRedeemed"],
                      )}
                    >
                      {item.conditionsResolved ? "Prepare settlement" : "Await resolution"}
                    </button>
                  </div>
                ))}
              </div>
              <TransactionTimeline stages={stages} chainId={config?.chainId ?? 0} />
            </section>
          )}

          {active === "Claims" && (
            <section className="panel">
              <div className="panel-head"><h2>Claim balances</h2><span>Partial or full redemption</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Claim</span><span>Type</span><span>Bundle</span><span>Balance</span><span>Action</span></div>
                {claims.map((claim) => (
                  <div className="data-row" key={claim.tokenId}>
                    <b>{claim.tokenId}</b><em>{claim.claimType}</em><span>{claim.bundleId}</span>
                    <span>{claim.holderBalanceAtomic ?? "0"} claim units</span>
                    <div className="claim-actions">
                      <input
                        className="quantity-input"
                        aria-label={`Redemption amount for ${claim.tokenId}`}
                        value={claimAmounts[claim.tokenId] ?? claim.holderBalanceAtomic ?? "0"}
                        onChange={(event) => setClaimAmounts((current) => ({
                          ...current,
                          [claim.tokenId]: event.target.value,
                        }))}
                      />
                      <button
                        className="ghost"
                        disabled={!session || !claim.holderBalanceAtomic || !config?.mainnetExecution}
                        onClick={() => executePrepared(
                          `/claims/${claim.tokenId}/prepare-redemption`,
                          {
                            amountAtomic:
                              claimAmounts[claim.tokenId] ?? claim.holderBalanceAtomic ?? "0",
                          },
                          `REDEEM_${claim.tokenId}`,
                          [claim.claimType === "PRINCIPAL" ? "PrincipalClaimed" : "ResidualClaimed"],
                        )}
                      >
                        Redeem
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {active === "Pool" && (
            <section className="workspace-grid">
              <div className="panel">
                <div className="panel-head"><h2>EventClear pilot pool</h2><span>Allowlisted ERC-4626</span></div>
                <div className="pool-stats">
                  <div><label>Total assets</label><strong>{formatPusd(pool?.totalAssetsAtomic)}</strong></div>
                  <div><label>Liquid reserve</label><strong>{formatPusd(pool?.liquidAtomic)}</strong></div>
                  <div><label>Outstanding cost</label><strong>{formatPusd(pool?.outstandingAdvanceCostBasisAtomic)}</strong></div>
                  <div><label>Pending quoted fees</label><strong>{formatPusd(pool?.outstandingQuotedFeesAtomic)}</strong></div>
                  <div><label>Realized yield</label><strong>{formatPusd(pool?.realizedYieldAtomic)}</strong></div>
                  <div><label>Realized loss</label><strong>{formatPusd(pool?.realizedLossAtomic)}</strong></div>
                </div>
              </div>
              <div className="panel solver-card">
                <div className="panel-head"><h2>LP transaction</h2><span>Public deposits disabled</span></div>
                <div className="solver-body">
                  <label className="input-label">Deposit amount</label>
                  <div className="amount-input">
                    <input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
                    <span>pUSD</span>
                  </div>
                  <button
                    className="analyze wide"
                    disabled={!wallet || !session || !config?.mainnetExecution}
                    onClick={depositOnchain}
                  >
                    {config?.mainnetExecution ? "Approve and deposit" : "Read-only"}
                  </button>
                  <hr />
                  <label className="input-label">Available withdrawal</label>
                  <strong>{formatPusd(poolAccount?.availableWithdrawalAtomic)} pUSD</strong>
                  <label className="input-label transaction-label">Withdraw amount</label>
                  <div className="amount-input">
                    <input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} />
                    <span>pUSD</span>
                  </div>
                  <button
                    className="ghost wide"
                    disabled={
                      !wallet
                      || !session
                      || !config?.mainnetExecution
                      || !poolAccount?.availableWithdrawalAtomic
                    }
                    onClick={() => {
                      try {
                        const amount = parsePusdAtomic(withdrawAmount);
                        void executePrepared(
                          "/pool/prepare-withdrawal",
                          {
                            amountAtomic: amount.toString(),
                            receiver: wallet,
                            owner: wallet,
                          },
                          "POOL_WITHDRAWAL",
                          ["Withdraw"],
                        );
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "POOL_WITHDRAWAL_FAILED");
                      }
                    }}
                  >
                    {config?.mainnetExecution ? "Withdraw available assets" : "Read-only"}
                  </button>
                  <small className="form-note">
                    LP shares: {poolAccount?.sharesAtomic ?? "Unavailable"} ·{" "}
                    allowlist: {poolAccount ? (poolAccount.allowlisted ? "approved" : "not approved") : "Unavailable"}
                  </small>
                </div>
              </div>
            </section>
          )}

          {active === "Registry" && (
            <section className="panel">
              <div className="panel-head"><h2>Relationship registry</h2><span>Immutable reviewed versions</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Definition</span><span>Type</span><span>Version</span><span>Status</span><span>Rule hash</span></div>
                {relationships.map((item) => (
                  <div className="data-row" key={item.id}>
                    <b>{item.id}</b><span>{item.relationshipType}</span><span>v{item.version}</span>
                    <em className={item.status === "APPROVED" ? "" : "warn"}>{item.status}</em>
                    <code>{item.resolutionRulesHash.slice(0, 10)}…</code>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      {analysis && wallet && config && (
        <LifecycleDrawer
          analysis={analysis}
          wallet={wallet}
          session={session}
          config={config}
          stages={stages}
          recordStage={record}
          onClose={() => setAnalysis(null)}
        />
      )}
    </main>
  );
}
