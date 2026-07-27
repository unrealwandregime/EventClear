"use client";

import { useState } from "react";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

const opportunities = [
  { id: "btc", title: "BTC threshold ladder · 31 Dec 2026", detail: "YES > $100K + NO > $150K", status: "Solver verified", floor: "100.00", market: "126.40", unlock: "93.50", residual: "up to 100.00", enabled: true },
  { id: "eth", title: "ETH threshold ladder · 30 Sep 2026", detail: "80 YES > $5K + 100 NO > $8K", status: "Solver verified", floor: "80.00", market: "104.18", unlock: "74.80", residual: "up to 100.00", enabled: true },
  { id: "election", title: "Election implication · Candidate A", detail: "Wins nomination + NO wins presidency", status: "Review required", floor: "—", market: "62.80", unlock: "—", residual: "—", enabled: false },
];

const navItems = ["Overview", "Scanner", "Bundles", "Pool", "Registry"];

export function EventClearApp() {
  const [active, setActive] = useState("Overview");
  const [selected, setSelected] = useState<(typeof opportunities)[number] | null>(null);
  const [wallet, setWallet] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState("");
  const [depositAmount, setDepositAmount] = useState("10000");

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
              <div className="metric"><label>Guaranteed collateral</label><strong>482,640.00</strong><small>pUSD principal</small></div>
              <div className="metric"><label>Capital unlocked</label><strong>451,268.40</strong><small>93.49% effective</small></div>
              <div className="metric"><label>Pool utilization</label><strong>61.8%</strong><small>within 80% cap</small></div>
              <div className="metric"><label>Active relationships</label><strong>24</strong><small>17 threshold · 7 reviewed</small></div>
            </div>

            <section className="panel">
              <div className="panel-head"><h2>Compression opportunities</h2><span>Preview data · Polygon 137</span></div>
              {opportunities.map((row) => (
                <div className="opportunity" key={row.id}>
                  <div className="pair"><strong>{row.title}</strong><span>{row.detail}</span><span className={`pill ${row.enabled ? "" : "review"}`}>{row.status}</span></div>
                  <div className="cell"><label>Guaranteed floor</label><b>{row.floor} pUSD</b></div>
                  <div className="cell"><label>Market value</label><b>{row.market} pUSD</b></div>
                  <div className="cell"><label>Net advance</label><b>{row.unlock} pUSD</b></div>
                  <div className="cell"><label>Residual</label><b>{row.residual}</b></div>
                  <button className="analyze" disabled={!row.enabled} onClick={() => setSelected(row)}>{row.enabled ? "Analyze bundle" : "Unavailable"}</button>
                </div>
              ))}
            </section>

            <div className="bottom-grid">
              <section className="panel">
                <div className="panel-head"><h2>Active bundle EC-00418</h2><span>Resolution expected 31 Dec 2026</span></div>
                <div className="worlds">
                  <div className="world-row"><span>Position</span><span>Escrowed</span><span>Status</span></div>
                  <div className="world-row"><span>BTC above $100K · YES</span><span>100.00</span><span className="floor">Active</span></div>
                  <div className="world-row"><span>BTC above $150K · NO</span><span>100.00</span><span className="floor">Active</span></div>
                </div>
              </section>
              <section className="panel">
                <div className="panel-head"><h2>Capital authorization gates</h2><span>6 / 6 passing</span></div>
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
                  <label className="data-row"><input type="checkbox" defaultChecked /><span>BTC closes above $100K · YES</span><b>100.00</b><span>64.00 pUSD</span><em>Exact</em></label>
                  <label className="data-row"><input type="checkbox" defaultChecked /><span>BTC closes above $150K · NO</span><b>100.00</b><span>62.40 pUSD</span><em>Exact</em></label>
                  <label className="data-row"><input type="checkbox" /><span>ETH reaches $8K · YES</span><b>42.00</b><span>18.90 pUSD</span><em className="warn">Incompatible</em></label>
                </div>
              </div>
              <div className="panel solver-card">
                <div className="panel-head"><h2>Deterministic solver</h2><span>3 terminal worlds</span></div>
                <div className="solver-body">
                  <p className="eyebrow">Eligible · definition v3</p>
                  <strong className="solver-floor">100.00 <small>pUSD floor</small></strong>
                  <dl>
                    <div><dt>Maximum payout</dt><dd>200.00 pUSD</dd></div>
                    <div><dt>Net advance</dt><dd>93.50 pUSD</dd></div>
                    <div><dt>Protocol fee</dt><dd>0.50 pUSD</dd></div>
                    <div><dt>Proof</dt><dd>0xd18e…4a2f</dd></div>
                  </dl>
                  <button className="analyze wide" onClick={() => setSelected(opportunities[0])}>Review quote</button>
                </div>
              </div>
            </section>
          )}

          {active === "Bundles" && (
            <section className="panel">
              <div className="panel-head"><h2>Bundle ledger</h2><span>Principal-first settlement</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Bundle</span><span>Status</span><span>Principal</span><span>Advance</span><span>Residual claim</span></div>
                <div className="data-row"><b>EC-00418</b><em>Active</em><span>100.00 pUSD</span><span>93.50 pUSD</span><span>100.00 ecRES</span></div>
                <div className="data-row"><b>EC-00391</b><em>Settlement ready</em><span>80.00 pUSD</span><span>74.80 pUSD</span><span>80.00 ecRES</span></div>
                <div className="data-row"><b>EC-00372</b><em className="warn">Shortfall</em><span>100.00 pUSD</span><span>93.50 pUSD</span><span>0.00 redeemed</span></div>
              </div>
              <div className="panel-foot"><span>Settlement stays permissionless while originations are paused.</span><button className="ghost">Prepare settlement</button></div>
            </section>
          )}

          {active === "Pool" && (
            <section className="workspace-grid">
              <div className="panel">
                <div className="panel-head"><h2>EventClear pilot pool</h2><span>ERC-4626 · allowlisted</span></div>
                <div className="pool-stats">
                  <div><label>Total assets</label><strong>780,000.00</strong><small>pUSD</small></div>
                  <div><label>Liquid reserve</label><strong>298,000.00</strong><small>38.2%</small></div>
                  <div><label>Outstanding cost</label><strong>482,000.00</strong><small>pUSD</small></div>
                  <div><label>Realized net yield</label><strong>9,270.00</strong><small>after protocol fees</small></div>
                </div>
              </div>
              <div className="panel solver-card">
                <div className="panel-head"><h2>LP transaction</h2><span>Allowlist required</span></div>
                <div className="solver-body">
                  <label className="input-label">Deposit amount</label>
                  <div className="amount-input"><input inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /><span>pUSD</span></div>
                  <dl><div><dt>Estimated shares</dt><dd>{depositAmount || "0"} ecPUSD</dd></div><div><dt>Utilization after</dt><dd>61.0%</dd></div></dl>
                  <button className="analyze wide" disabled={!wallet || chainId !== 137}>Deposit on Polygon</button>
                  <small className="form-note">{wallet ? chainId === 137 ? "Wallet eligible for preflight checks." : "Switch wallet to Polygon 137." : "Connect wallet to continue."}</small>
                </div>
              </div>
            </section>
          )}

          {active === "Registry" && (
            <section className="panel">
              <div className="panel-head"><h2>Relationship registry</h2><span>Immutable versions · reviewed hashes</span></div>
              <div className="data-table">
                <div className="data-row data-head"><span>Definition</span><span>Type</span><span>Version</span><span>Status</span><span>Rule hash</span></div>
                <div className="data-row"><b>BTC close ladder · Dec 2026</b><span>Crypto threshold</span><span>v3</span><em>Approved</em><code>0xcdcd…cdcd</code></div>
                <div className="data-row"><b>ETH reach ladder · Sep 2026</b><span>Crypto threshold</span><span>v2</span><em>Approved</em><code>0x42a1…991c</code></div>
                <div className="data-row"><b>Candidate A implication</b><span>Election graph</span><span>v1</span><em className="warn">Review</em><code>0x7bf0…120a</code></div>
                <div className="data-row"><b>Championship progression</b><span>Sports graph</span><span>v1</span><em className="warn">Suspended</em><code>0xa9e4…e771</code></div>
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
              <h2 id="quote-title">{selected.title}</h2>
              <p>Proof 0xd18e…4a2f · Relationship v3 · quote lifetime 5 minutes</p>
              <div className="quote-grid">
                <div><label>Guaranteed floor</label><strong>{selected.floor} pUSD</strong></div>
                <div><label>Net advance</label><strong>{selected.unlock} pUSD</strong></div>
                <div><label>Principal claim</label><strong>{selected.floor} pUSD</strong></div>
                <div><label>Protocol fee</label><strong>0.50 pUSD</strong></div>
                <div><label>Reserve haircut</label><strong>1.00%</strong></div>
                <div><label>Residual upside</label><strong>{selected.residual}</strong></div>
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
