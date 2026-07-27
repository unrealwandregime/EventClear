"use client";

import { useState } from "react";

const opportunities = [
  {
    id: "btc",
    title: "BTC threshold ladder · 31 Dec 2026",
    detail: "YES > $100K + NO > $150K",
    status: "Solver verified",
    floor: "100.00",
    market: "126.40",
    unlock: "93.50",
    residual: "up to 100.00",
    enabled: true,
  },
  {
    id: "eth",
    title: "ETH threshold ladder · 30 Sep 2026",
    detail: "80 YES > $5K + 100 NO > $8K",
    status: "Solver verified",
    floor: "80.00",
    market: "104.18",
    unlock: "74.80",
    residual: "up to 100.00",
    enabled: true,
  },
  {
    id: "election",
    title: "Election implication · Candidate A",
    detail: "Wins nomination + NO wins presidency",
    status: "Review required",
    floor: "—",
    market: "62.80",
    unlock: "—",
    residual: "—",
    enabled: false,
  },
];

export function EventClearApp() {
  const [active, setActive] = useState("Overview");
  const [selected, setSelected] = useState<(typeof opportunities)[number] | null>(null);
  const [connected, setConnected] = useState(false);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><i className="brandmark" /><span>EventClear</span></div>
        <nav className="nav" aria-label="Primary navigation">
          {["Overview", "Scanner", "Bundles", "Pool", "Registry"].map((item) => (
            <button key={item} data-short={item.slice(0, 3)} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className="notice"><b>Experimental MVP</b>Unaudited protocol. Do not deposit funds you cannot afford to lose.</div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div className="breadcrumb">Protocol / {active}</div>
          <button className="wallet" onClick={() => setConnected(!connected)}>
            {connected ? "0x71C9…A40E · Local" : "Connect wallet"}
          </button>
        </header>

        <div className="content">
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
            <div className="panel-head"><h2>Compression opportunities</h2><span>Freshness: 8s · Polygon 137</span></div>
            {opportunities.map((row) => (
              <div className="opportunity" key={row.id}>
                <div className="pair"><strong>{row.title}</strong><span>{row.detail}</span><span className={`pill ${row.enabled ? "" : "review"}`}>{row.status}</span></div>
                <div className="cell"><label>Guaranteed floor</label><b>{row.floor} pUSD</b></div>
                <div className="cell"><label>Market value</label><b>{row.market} pUSD</b></div>
                <div className="cell"><label>Est. advance</label><b>{row.unlock} pUSD</b></div>
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
                <div className="risk">Canonical relationship v3 registered onchain</div>
                <div className="risk">Settlement rules and source hashes match</div>
                <div className="risk">Deterministic solver proof reproduced</div>
                <div className="risk">Risk quote bound to wallet, chain and vault</div>
                <div className="risk">Market metadata within freshness window</div>
                <div className="risk">Pool and exposure limits available</div>
              </div>
            </section>
          </div>
        </div>
      </section>

      {selected && (
        <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="quote-title" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <section className="quote">
            <div className="quote-body">
              <p className="eyebrow">Deterministic analysis</p>
              <h2 id="quote-title">{selected.title}</h2>
              <p>Proof 0xd18e…4a2f · Relationship v3 · valid for 04:32</p>
              <div className="quote-grid">
                <div><label>Guaranteed floor</label><strong>{selected.floor} pUSD</strong></div>
                <div><label>Immediate advance</label><strong>{selected.unlock} pUSD</strong></div>
                <div><label>Principal claim</label><strong>{selected.floor} pUSD</strong></div>
                <div><label>Origination fee</label><strong>0.50 pUSD</strong></div>
                <div><label>Reserve haircut</label><strong>1.00%</strong></div>
                <div><label>Residual upside</label><strong>{selected.residual}</strong></div>
              </div>
            </div>
            <div className="quote-actions">
              <button className="ghost" onClick={() => setSelected(null)}>Close</button>
              <button className="analyze" onClick={() => setConnected(true)}>Connect to request quote</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
