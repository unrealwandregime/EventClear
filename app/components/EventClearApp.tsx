"use client";

import { useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi } from "viem";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type ApiOpportunity = {
  relationshipId: string;
  status: string;
  guaranteedFloorAtomic?: string;
  estimatedAdvanceAtomic?: string;
};

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
  settlementProceedsAtomic?: string;
};

type RelationshipRecord = {
  id: string;
  relationshipType: string;
  version: number;
  status: string;
  resolutionRulesHash: string;
};

type PositionRecord = {
  tokenId: string;
  outcome: string;
  amountAtomic: string;
  currentValueAtomic?: string;
  title?: string;
};

type PoolRecord = {
  totalAssetsAtomic: string;
  liquidAtomic: string;
  outstandingAdvanceCostBasisAtomic: string;
  outstandingQuotedFeesAtomic: string;
  realizedYieldAtomic: string;
  utilizationBps: number;
};

type PublicConfig = {
  chainId: number;
  mainnetExecution: boolean;
  fundingPoolAddress?: `0x${string}`;
  collateralTokenAddress?: `0x${string}`;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const formatPusd = (atomic?: string) =>
  atomic === undefined
    ? "Unavailable"
    : (Number(atomic) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });

const navItems = ["Overview", "Scanner", "Bundles", "Pool", "Registry"];

export function EventClearApp() {
  const [active, setActive] = useState("Overview");
  const [selected, setSelected] = useState<ApiOpportunity | null>(null);
  const [wallet, setWallet] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState("");
  const [depositAmount, setDepositAmount] = useState("10000");
  const [apiOpportunities, setApiOpportunities] = useState<ApiOpportunity[]>([]);
  const [metrics, setMetrics] = useState<ProtocolMetrics | null>(null);
  const [bundles, setBundles] = useState<BundleRecord[]>([]);
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [pool, setPool] = useState<PoolRecord | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [transactionStatus, setTransactionStatus] = useState("");
  const [dataError, setDataError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${API_URL}/protocol/metrics`),
      fetch(`${API_URL}/bundles`),
      fetch(`${API_URL}/relationships`),
      fetch(`${API_URL}/pool`),
      fetch(`${API_URL}/config/public`),
    ])
      .then(async ([metricsResponse, bundlesResponse, relationshipsResponse, poolResponse, configResponse]) => {
        if (!metricsResponse.ok || !bundlesResponse.ok || !relationshipsResponse.ok || !configResponse.ok) {
          throw new Error("A verified protocol read model is unavailable");
        }
        return {
          metrics: await metricsResponse.json() as ProtocolMetrics,
          bundles: (await bundlesResponse.json() as { data: BundleRecord[] }).data,
          relationships: (await relationshipsResponse.json() as { data: RelationshipRecord[] }).data,
          pool: poolResponse.ok ? await poolResponse.json() as PoolRecord : null,
          config: await configResponse.json() as PublicConfig,
        };
      })
      .then((payload) => {
        if (!cancelled) {
          setMetrics(payload.metrics);
          setBundles(payload.bundles);
          setRelationships(payload.relationships);
          setPool(payload.pool);
          setPublicConfig(payload.config);
          setDataError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setDataError(error instanceof Error ? error.message : "Protocol API unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`${API_URL}/wallets/${wallet}/opportunities`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Scanner API returned ${response.status}`);
        return response.json() as Promise<{ candidates: ApiOpportunity[] }>;
      })
      .then((payload) => {
        if (!cancelled) setApiOpportunities(payload.candidates);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDataError(error instanceof Error ? error.message : "Scanner API unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`${API_URL}/wallets/${wallet}/positions`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Position API returned ${response.status}`);
        return response.json() as Promise<{ positions: PositionRecord[] }>;
      })
      .then((payload) => {
        if (!cancelled) setPositions(payload.positions);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDataError(error instanceof Error ? error.message : "Position API unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  async function connectWallet() {
    const provider = (window as typeof window & { ethereum?: EthereumProvider }).ethereum;
    if (!provider) {
      setWalletError("Install an EIP-1193 wallet to connect.");
      return;
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const chain = await provider.request({ method: "eth_chainId" }) as string;
      setWallet(accounts[0] ?? "");
      setChainId(Number.parseInt(chain, 16));
      setWalletError("");
    } catch {
      setWalletError("Wallet connection was cancelled.");
    }
  }

  async function depositOnchain() {
    const provider = (window as typeof window & { ethereum?: EthereumProvider }).ethereum;
    if (!provider || !wallet || !publicConfig?.fundingPoolAddress || !publicConfig.collateralTokenAddress) return;
    try {
      const [whole = "0", fraction = ""] = depositAmount.trim().split(".");
      if (!/^\d+$/.test(whole) || !/^\d{0,6}$/.test(fraction)) throw new Error("Use at most 6 decimal places.");
      const assets = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
      if (assets <= 0n) throw new Error("Deposit must be positive.");
      setTransactionStatus("Approve pUSD spending in your wallet.");
      await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: wallet,
          to: publicConfig.collateralTokenAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [publicConfig.fundingPoolAddress, assets],
          }),
        }],
      });
      const response = await fetch(`${API_URL}/pool/prepare-deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountAtomic: assets.toString(), receiver: wallet }),
      });
      if (!response.ok) throw new Error(`Deposit preflight returned ${response.status}`);
      const prepared = await response.json() as { transactionRequest: { to: string; data: string; value: string } };
      setTransactionStatus("Confirm the ERC-4626 deposit in your wallet.");
      await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet, ...prepared.transactionRequest }],
      });
      setTransactionStatus("Deposit submitted. Await indexed confirmation.");
    } catch (error) {
      setTransactionStatus(error instanceof Error ? error.message : "Deposit failed.");
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><i className="brandmark" /><span>EventClear</span></div>
        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item} data-short={item.slice(0, 3)} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="notice"><b>Mainnet candidate</b>Unaudited protocol. Execution remains disabled until audit and multisig activation.</div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="breadcrumb">Protocol / {active}</div>
          <button className="wallet" onClick={connectWallet}>
            {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)} · ${chainId === 137 ? "Polygon" : `Chain ${chainId}`}` : "Connect wallet"}
          </button>
        </header>

        <div className="content">
          <div className="release-strip">
            <span><i /> Mainnet release candidate</span>
            <b>Standard markets only · execution gated pending audit and multisig activation</b>
          </div>
          {walletError && <p className="wallet-error" role="alert">{walletError}</p>}
          {dataError && <p className="wallet-error" role="alert">Verified protocol data unavailable: {dataError}</p>}

          {active === "Overview" && <>
            <div className="hero">
              <div>
                <p className="eyebrow">Provable collateral compression</p>
                <h1>Unlock guaranteed value before markets resolve.</h1>
                <p className="lede">EventClear advances pUSD against the mathematically proven minimum payout of formally related outcome positions—while you keep the residual upside.</p>
              </div>
              <div className="panel worlds" aria-label="Example payoff">
                <div className="world-row"><span>BTC state</span><span>Combined payout</span><span>Floor</span></div>
                <div className="world-row"><span>Below $100K</span><span>100.00 pUSD</span><span className="floor">100.00</span></div>
                <div className="world-row"><span>$100K–$150K</span><span>200.00 pUSD</span><span>—</span></div>
                <div className="world-row"><span>Above $150K</span><span>100.00 pUSD</span><span className="floor">100.00</span></div>
              </div>
            </div>

            <div className="metric-grid">
              <div className="metric"><label>Guaranteed collateral</label><strong>{metrics?.available ? formatPusd(metrics.guaranteedFloorEscrowedAtomic) : "Unavailable"}</strong><small>verified pUSD principal</small></div>
              <div className="metric"><label>Capital unlocked</label><strong>{metrics?.available ? formatPusd(metrics.netAdvancesAtomic) : "Unavailable"}</strong><small>verified net advances</small></div>
              <div className="metric"><label>Active bundles</label><strong>{metrics?.available ? metrics.activeBundles : "Unavailable"}</strong><small>indexed protocol state</small></div>
              <div className="metric"><label>Active relationships</label><strong>{metrics?.available ? metrics.approvedRelationships : "Unavailable"}</strong><small>reviewed definitions</small></div>
            </div>

            <section className="panel">
              <div className="panel-head"><h2>Compression opportunities</h2><span>Verified API data · Polygon 137</span></div>
              {!wallet && <p className="form-note">Connect a wallet to scan its indexed positions.</p>}
              {wallet && apiOpportunities.length === 0 && <p className="form-note">No financing-eligible reviewed relationship was found.</p>}
              {apiOpportunities.map((row) => (
                <div className="opportunity" key={row.relationshipId}>
                  <div className="pair"><strong>{row.relationshipId}</strong><span>Reviewed relationship match</span><span className="pill">{row.status}</span></div>
                  <div className="cell"><label>Guaranteed floor</label><b>{formatPusd(row.guaranteedFloorAtomic)} pUSD</b></div>
                  <div className="cell"><label>Net advance</label><b>{formatPusd(row.estimatedAdvanceAtomic)} pUSD</b></div>
                  <button className="analyze" onClick={() => setSelected(row)}>Analyze bundle</button>
                </div>
              ))}
            </section>

            <div className="bottom-grid">
              <section className="panel">
                <div className="panel-head"><h2>Active bundle EC-00418</h2><span>Resolution expected 31 Dec 2026</span></div>
                <div className="worlds">
                  <div className="world-row"><span>Bundle</span><span>Principal</span><span>Status</span></div>
                  {bundles.filter((item) => item.status === "ACTIVE").slice(0, 2).map((item) => (
                    <div className="world-row" key={item.id}><span>{item.id}</span><span>{formatPusd(item.principalAmountAtomic)}</span><span className="floor">{item.status}</span></div>
                  ))}
                  {!bundles.some((item) => item.status === "ACTIVE") && <div className="world-row"><span>No verified active bundle</span><span>—</span><span>Unavailable</span></div>}
                </div>
              </section>
              <section className="panel">
                <div className="panel-head"><h2>Capital authorization gates</h2><span>Required before execution</span></div>
                <div className="risk-list">
                  {["Canonical relationship registered onchain", "Settlement rule hashes match", "Solver proof reproduced", "Quote bound to wallet, chain and vault", "Market data within freshness window", "Pool exposure limits available"].map((gate) => <div className="risk" key={gate}>{gate}</div>)}
                </div>
              </section>
            </div>
          </>}

          {active === "Scanner" && (
            <section className="workspace-grid">
              <div className="panel">
                <div className="panel-head"><h2>Indexed wallet positions</h2><span>{wallet ? "Account resolved" : "Connect wallet to refresh"}</span></div>
                <div className="data-table">
                  <div className="data-row data-head"><span>Include</span><span>Position</span><span>Balance</span><span>Value</span><span>Rule match</span></div>
                  {positions.map((position) => (
                    <label className="data-row" key={position.tokenId}><input type="checkbox" /><span>{position.title ?? `${position.outcome} token ${position.tokenId.slice(0, 10)}…`}</span><b>{formatPusd(position.amountAtomic)}</b><span>{formatPusd(position.currentValueAtomic)} pUSD</span><em>Indexed</em></label>
                  ))}
                  {positions.length === 0 && <div className="data-row"><span>—</span><span>No indexed positions</span><span>—</span><span>—</span><em>Unavailable</em></div>}
                </div>
              </div>
              <div className="panel solver-card">
                <div className="panel-head"><h2>Deterministic solver</h2><span>3 terminal worlds</span></div>
                <div className="solver-body">
                  <p className="eyebrow">{apiOpportunities.length ? "Eligible reviewed definition" : "No verified candidate"}</p>
                  <strong className="solver-floor">{formatPusd(apiOpportunities[0]?.guaranteedFloorAtomic)} <small>pUSD floor</small></strong>
                  <dl>
                    <div><dt>Net advance</dt><dd>{formatPusd(apiOpportunities[0]?.estimatedAdvanceAtomic)} pUSD</dd></div>
                    <div><dt>Relationship</dt><dd>{apiOpportunities[0]?.relationshipId ?? "Unavailable"}</dd></div>
                  </dl>
                  <button className="analyze wide" disabled={apiOpportunities.length === 0} onClick={() => setSelected(apiOpportunities[0] ?? null)}>Review quote</button>
                </div>
              </div>
            </section>
          )}

          {active === "Bundles" && (
            <section className="panel">
              <div className="panel-head"><h2>Bundle ledger</h2><span>Principal-first settlement</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Bundle</span><span>Status</span><span>Principal</span><span>Advance</span><span>Residual claim</span></div>
                {bundles.map((item) => (
                  <div className="data-row" key={item.id}><b>{item.id}</b><em className={item.status === "SHORTFALL" ? "warn" : ""}>{item.status}</em><span>{formatPusd(item.principalAmountAtomic)} pUSD</span><span>{formatPusd(item.grossAdvanceAtomic)} pUSD</span><span>Onchain claim ledger</span></div>
                ))}
              </div>
              <div className="panel-foot"><span>Settlement stays permissionless while originations are paused.</span><button className="ghost">Prepare settlement</button></div>
            </section>
          )}

          {active === "Pool" && (
            <section className="workspace-grid">
              <div className="panel">
                <div className="panel-head"><h2>EventClear pilot pool</h2><span>ERC-4626 · allowlisted</span></div>
                <div className="pool-stats">
                  <div><label>Total assets</label><strong>{formatPusd(pool?.totalAssetsAtomic)}</strong><small>pUSD</small></div>
                  <div><label>Liquid reserve</label><strong>{formatPusd(pool?.liquidAtomic)}</strong><small>verified balance</small></div>
                  <div><label>Outstanding cost</label><strong>{formatPusd(pool?.outstandingAdvanceCostBasisAtomic)}</strong><small>pUSD</small></div>
                  <div><label>Quoted fees pending</label><strong>{formatPusd(pool?.outstandingQuotedFeesAtomic)}</strong><small>unearned</small></div>
                  <div><label>Realized net yield</label><strong>{formatPusd(pool?.realizedYieldAtomic)}</strong><small>after protocol fees</small></div>
                </div>
              </div>
              <div className="panel solver-card">
                <div className="panel-head"><h2>LP transaction</h2><span>Allowlist required</span></div>
                <div className="solver-body">
                  <label className="input-label">Deposit amount</label>
                  <div className="amount-input"><input inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /><span>pUSD</span></div>
                  <dl><div><dt>Requested assets</dt><dd>{depositAmount || "0"} pUSD</dd></div><div><dt>Current utilization</dt><dd>{pool ? `${pool.utilizationBps / 100}%` : "Unavailable"}</dd></div></dl>
                  <button className="analyze wide" disabled={!wallet || chainId !== publicConfig?.chainId || !publicConfig?.mainnetExecution} onClick={depositOnchain}>
                    {publicConfig?.mainnetExecution ? "Deposit onchain" : "Execution disabled"}
                  </button>
                  <small className="form-note">{transactionStatus || (wallet ? chainId === publicConfig?.chainId ? "Wallet eligible for preflight checks." : `Switch wallet to chain ${publicConfig?.chainId ?? "configured network"}.` : "Connect wallet to continue.")}</small>
                </div>
              </div>
            </section>
          )}

          {active === "Registry" && (
            <section className="panel">
              <div className="panel-head"><h2>Relationship registry</h2><span>Immutable versions · reviewed hashes</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Definition</span><span>Type</span><span>Version</span><span>Status</span><span>Rule hash</span></div>
                {relationships.map((item) => (
                  <div className="data-row" key={item.id}><b>{item.id}</b><span>{item.relationshipType}</span><span>v{item.version}</span><em className={item.status === "APPROVED" ? "" : "warn"}>{item.status}</em><code>{item.resolutionRulesHash.slice(0, 8)}…{item.resolutionRulesHash.slice(-4)}</code></div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      {selected && (
        <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="quote-title" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section className="quote">
            <div className="quote-body">
              <p className="eyebrow">Deterministic analysis</p>
              <h2 id="quote-title">{selected.relationshipId}</h2>
              <p>Proof 0xd18e…4a2f · Relationship v3 · quote lifetime 5 minutes</p>
              <div className="quote-grid">
                <div><label>Guaranteed floor</label><strong>{formatPusd(selected.guaranteedFloorAtomic)} pUSD</strong></div>
                <div><label>Net advance</label><strong>{formatPusd(selected.estimatedAdvanceAtomic)} pUSD</strong></div>
                <div><label>Principal claim</label><strong>{formatPusd(selected.guaranteedFloorAtomic)} pUSD</strong></div>
                <div><label>Quoted origination fee</label><strong>Calculated on live quote</strong></div>
                <div><label>Reserve haircut</label><strong>1.00%</strong></div>
                <div><label>Residual upside</label><strong>Retained by borrower claim</strong></div>
              </div>
            </div>
            <div className="quote-actions">
              <button className="ghost" onClick={() => setSelected(null)}>Close</button>
              <button className="analyze" onClick={wallet ? () => setSelected(null) : connectWallet}>{wallet ? "Preflight complete" : "Connect to request quote"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
