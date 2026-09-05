"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type MarketRecord = {
  conditionId: string;
  marketId: string;
  question: string;
  endDate?: string | null;
  negativeRisk: boolean;
  slug: string;
  yesPrice?: number | null;
  noPrice?: number | null;
  liquidity: number;
  volume24h: number;
};

type MarketResponse = { data: MarketRecord[]; fetchedAt?: string };

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 2,
  }).format(value);
}

function formatDollars(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 6 : 2,
  })}`;
}

export function InvestorHomepage() {
  const [markets, setMarkets] = useState<MarketRecord[]>([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketState, setMarketState] = useState<"loading" | "ready" | "retrying">("loading");
  const [marketFetchedAt, setMarketFetchedAt] = useState("");
  const [lowerShares, setLowerShares] = useState("1");
  const [upperShares, setUpperShares] = useState("1");
  const [lowerPrice, setLowerPrice] = useState("0.49");
  const [upperPrice, setUpperPrice] = useState("0.42");

  useEffect(() => {
    fetch("/api/v1/markets")
      .then((response) => {
        if (!response.ok) throw new Error("MARKET_FEED_UNAVAILABLE");
        return response.json() as Promise<MarketResponse>;
      })
      .then((result) => {
        setMarkets(result.data);
        setMarketFetchedAt(result.fetchedAt ?? "");
        setMarketState("ready");
      })
      .catch(() => setMarketState("retrying"));
  }, []);

  const filteredMarkets = useMemo(() => {
    const query = marketQuery.trim().toLowerCase();
    const results = query
      ? markets.filter((market) =>
        market.question.toLowerCase().includes(query)
        || market.marketId.toLowerCase().includes(query)
      )
      : markets;
    return results.slice(0, 6);
  }, [marketQuery, markets]);

  const proof = useMemo(() => {
    const lower = Number(lowerShares);
    const upper = Number(upperShares);
    const lowerEntry = Number(lowerPrice);
    const upperEntry = Number(upperPrice);
    const values = [lower, upper, lowerEntry, upperEntry];
    if (
      values.some((value) => !Number.isFinite(value))
      || lower <= 0
      || upper <= 0
      || lowerEntry < 0
      || upperEntry < 0
      || lowerEntry > 1
      || upperEntry > 1
    ) return null;
    const floor = Math.min(lower, upper);
    const acquisitionCost = lower * lowerEntry + upper * upperEntry;
    return {
      floor,
      acquisitionCost,
      collateralEdge: floor - acquisitionCost,
      illustrativeAdvance: floor * 0.85,
      worlds: [upper, lower + upper, lower],
    };
  }, [lowerPrice, lowerShares, upperPrice, upperShares]);

  return (
    <main className="investor-root">
      <nav className="investor-nav" aria-label="Investor site navigation">
        <Link className="investor-brand" href="/" aria-label="EventClear home">
          <i className="investor-brandmark" aria-hidden="true" />
          <span>EventClear</span>
        </Link>
        <div className="investor-nav-links">
          <a href="#how">How it works</a>
          <a href="#live-scanner">Live scanner</a>
          <a href="#proof">Proof</a>
          <a href="#progress">Progress</a>
        </div>
        <div className="investor-nav-actions">
          <span className="investor-live-state"><i aria-hidden="true" /> Live research release</span>
          <a className="investor-app-link" href="/app">Protocol app <span aria-hidden="true">↗</span></a>
        </div>
      </nav>

      <section className="investor-hero">
        <div className="investor-hero-copy">
          <p className="investor-kicker">Provable collateral for prediction markets</p>
          <h1>Unlock guaranteed value before prediction markets resolve.</h1>
          <p className="investor-lede">
            EventClear identifies provably collateralized combinations of prediction-market
            positions and lets holders access capital against their guaranteed payout floor.
          </p>
          <div className="investor-actions">
            <a className="investor-primary-action" href="#proof">Run the proof</a>
            <a className="investor-secondary-action" href="#live-scanner">Explore live markets</a>
          </div>
          <div className="investor-signal-row" aria-label="Live product signals">
            <span><strong>{markets.length || "Live"}</strong> markets scanned</span>
            <span><strong>Exact</strong> payout proofs</span>
            <span><strong>Pre-launch</strong> capital pilot</span>
          </div>
        </div>

        <section className="investor-demo-card" aria-label="EventClear mechanism demonstration">
          <div className="investor-demo-head">
            <span><i aria-hidden="true" /> Live research demo</span>
            <small>Canonical threshold proof</small>
          </div>
          <div className="investor-demo-legs">
            <div><small>POSITION 01</small><strong>BTC &gt; $100K</strong><span>YES</span></div>
            <b aria-hidden="true">+</b>
            <div><small>POSITION 02</small><strong>BTC &gt; $150K</strong><span>NO</span></div>
          </div>
          <div className="investor-proof-line"><span>Every terminal state</span><i aria-hidden="true" /><strong>PROVEN</strong></div>
          <div className="investor-demo-primary">
            <span>Guaranteed terminal payout</span>
            <strong>$1.00</strong>
          </div>
          <div className="investor-demo-metrics">
            <div><span>Example acquisition cost</span><strong>$0.91</strong></div>
            <div><span>Provable collateral edge</span><strong className="positive">$0.09</strong></div>
            <div><span>Illustrative advance</span><strong>$0.85</strong></div>
          </div>
          <p>Illustrative pricing and advance terms. The $1.00 payout floor is calculated across every valid terminal region.</p>
        </section>
      </section>

      <section className="investor-proof-band" aria-label="Current product capabilities">
        <div><span>01</span><strong>Live market discovery</strong><small>Public Polymarket data</small></div>
        <div><span>02</span><strong>Deterministic solver</strong><small>Every terminal world</small></div>
        <div><span>03</span><strong>Lifecycle validated</strong><small>Local + Polygon fork</small></div>
        <div><span>04</span><strong>Capital controls</strong><small>Locked pending audit</small></div>
      </section>

      <section className="investor-section investor-how" id="how">
        <div className="investor-section-heading">
          <p className="investor-kicker">How EventClear works</p>
          <h2>From fragmented positions to financeable collateral.</h2>
          <p>EventClear turns a portfolio-level guarantee into an inspectable proof and a bounded financing decision.</p>
        </div>
        <div className="investor-steps">
          <article><span>01 / SCAN</span><h3>Find formal relationships</h3><p>Discover positions tied to the same underlying event and review the exact resolution rules that connect them.</p></article>
          <article><span>02 / PROVE</span><h3>Enumerate every outcome</h3><p>The deterministic solver calculates the portfolio payout in every valid terminal world and identifies the minimum.</p></article>
          <article><span>03 / FINANCE</span><h3>Advance against the floor</h3><p>A risk policy can price a conservative advance without taking directional market risk. Capital launch follows audit.</p></article>
        </div>
      </section>

      <section className="investor-section investor-live-section" id="live-scanner">
        <div className="investor-section-heading investor-heading-row">
          <div>
            <p className="investor-kicker">Live opportunity universe</p>
            <h2>The markets are already moving.</h2>
            <p>Search the live public feed that powers EventClear research. Listings are discovery inputs, not approved collateral relationships.</p>
          </div>
          <div className="investor-feed-status">
            <span className={marketState}><i aria-hidden="true" /> {marketState === "ready" ? `${markets.length} live markets` : marketState === "loading" ? "Connecting to feed" : "Feed reconnecting"}</span>
            {marketFetchedAt && <small>Updated {new Date(marketFetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>}
          </div>
        </div>
        <div className="investor-market-tool">
          <label htmlFor="investor-market-search">Search market universe</label>
          <input
            id="investor-market-search"
            type="search"
            placeholder="Search question or market ID"
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
          />
          <span>{filteredMarkets.length} shown</span>
        </div>
        <div className="investor-market-grid" aria-live="polite">
          {filteredMarkets.map((market) => (
            <article className="investor-market-card" key={market.conditionId}>
              <div className="investor-market-meta"><span>{market.negativeRisk ? "MULTI-OUTCOME" : "BINARY"}</span><small>#{market.marketId}</small></div>
              <h3>{market.question}</h3>
              <div className="investor-price-pair">
                <div><span>YES</span><strong>{market.yesPrice == null ? "—" : `${(market.yesPrice * 100).toFixed(1)}¢`}</strong></div>
                <div><span>NO</span><strong>{market.noPrice == null ? "—" : `${(market.noPrice * 100).toFixed(1)}¢`}</strong></div>
              </div>
              <div className="investor-market-stats"><span>24h {formatUsd(market.volume24h)}</span><span>Liq. {formatUsd(market.liquidity)}</span></div>
              <a href={`https://polymarket.com/event/${encodeURIComponent(market.slug)}`} target="_blank" rel="noreferrer">Inspect source <span aria-hidden="true">↗</span></a>
            </article>
          ))}
          {marketState === "loading" && [0, 1, 2].map((item) => <div className="investor-market-card investor-market-loading" key={item} aria-hidden="true" />)}
          {marketState === "ready" && filteredMarkets.length === 0 && <p className="investor-market-empty">No markets match that search. Try a broader term.</p>}
          {marketState === "retrying" && <p className="investor-market-empty">The public feed is reconnecting. The proof mechanism below remains available locally.</p>}
        </div>
      </section>

      <section className="investor-section investor-proof-lab" id="proof">
        <div className="investor-proof-intro">
          <p className="investor-kicker">Interactive collateral proof</p>
          <h2>Don’t trust a claim. Inspect every world.</h2>
          <p>Adjust the position sizes and illustrative entry prices. The payout floor updates from the complete terminal-state set.</p>
          <div className="investor-proof-inputs">
            <label><span>YES shares · BTC &gt; $100K</span><input type="number" min="0.000001" step="0.01" value={lowerShares} onChange={(event) => setLowerShares(event.target.value)} /></label>
            <label><span>Entry price per YES share</span><input type="number" min="0" max="1" step="0.01" value={lowerPrice} onChange={(event) => setLowerPrice(event.target.value)} /></label>
            <label><span>NO shares · BTC &gt; $150K</span><input type="number" min="0.000001" step="0.01" value={upperShares} onChange={(event) => setUpperShares(event.target.value)} /></label>
            <label><span>Entry price per NO share</span><input type="number" min="0" max="1" step="0.01" value={upperPrice} onChange={(event) => setUpperPrice(event.target.value)} /></label>
          </div>
          {!proof && <p className="investor-proof-warning" role="status">Enter positive share amounts and prices between $0 and $1.</p>}
        </div>

        <div className="investor-proof-output" aria-live="polite">
          <div className="investor-output-head"><span>Terminal state</span><span>Portfolio payout</span></div>
          <div className="investor-world-row"><span>BTC ≤ $100K</span><strong>{proof ? formatDollars(proof.worlds[0]) : "—"}</strong></div>
          <div className="investor-world-row"><span>$100K &lt; BTC ≤ $150K</span><strong>{proof ? formatDollars(proof.worlds[1]) : "—"}</strong></div>
          <div className="investor-world-row"><span>BTC &gt; $150K</span><strong>{proof ? formatDollars(proof.worlds[2]) : "—"}</strong></div>
          <div className="investor-floor-result"><span>Guaranteed payout floor</span><strong>{proof ? formatDollars(proof.floor) : "—"}</strong><small>Minimum across all valid terminal states</small></div>
          <div className="investor-proof-economics">
            <div><span>Illustrative acquisition cost</span><strong>{proof ? formatDollars(proof.acquisitionCost) : "—"}</strong></div>
            <div><span>Collateral edge</span><strong className={proof && proof.collateralEdge >= 0 ? "positive" : ""}>{proof ? formatDollars(proof.collateralEdge) : "—"}</strong></div>
            <div><span>Illustrative advance · 85% floor</span><strong>{proof ? formatDollars(proof.illustrativeAdvance) : "—"}</strong></div>
          </div>
          <p>Research calculator only. Prices are user-set assumptions; no quote or financing offer is generated.</p>
        </div>
      </section>

      <section className="investor-section investor-why">
        <div className="investor-section-heading">
          <p className="investor-kicker">Why it matters</p>
          <h2>Prediction markets create value that cannot yet move.</h2>
        </div>
        <div className="investor-comparison">
          <div className="investor-comparison-head"><span>Today</span><span>With EventClear</span></div>
          <div><span>Related positions remain valued one market at a time.</span><strong>A portfolio-level guaranteed floor is identified.</strong></div>
          <div><span>Capital stays locked until the last market resolves.</span><strong>A conservative advance can be bounded by proof.</strong></div>
          <div><span>Risk depends on opaque assumptions and manual review.</span><strong>Every relationship, world and payout is reproducible.</strong></div>
        </div>
      </section>

      <section className="investor-section investor-architecture">
        <div className="investor-section-heading investor-heading-row">
          <div>
            <p className="investor-kicker">Protocol architecture</p>
            <h2>Built as a verification pipeline, not a black box.</h2>
          </div>
          <p>Each layer narrows what the next layer is allowed to trust. Public capital stays disabled until the complete production boundary is reviewed.</p>
        </div>
        <div className="investor-architecture-flow">
          <article><span>01</span><small>LIVE</small><h3>Market data</h3><p>Public order and market state</p></article>
          <i aria-hidden="true">→</i>
          <article><span>02</span><small>BUILT</small><h3>Relationship registry</h3><p>Versioned, reviewed definitions</p></article>
          <i aria-hidden="true">→</i>
          <article><span>03</span><small>BUILT</small><h3>Solver + risk</h3><p>Exact worlds and bounded quotes</p></article>
          <i aria-hidden="true">→</i>
          <article><span>04</span><small>TESTED</small><h3>Vault + pool</h3><p>Escrow, advance and claims</p></article>
          <i aria-hidden="true">→</i>
          <article><span>05</span><small>PENDING</small><h3>Capital pilot</h3><p>Audit-gated controlled launch</p></article>
        </div>
      </section>

      <section className="investor-section investor-progress" id="progress">
        <div className="investor-section-heading">
          <p className="investor-kicker">Current progress</p>
          <h2>Research is live. Capital launches deliberately.</h2>
          <p>The engineering stack has moved through implementation and lifecycle validation. The next phase converts that work into an independently reviewed pilot.</p>
        </div>
        <div className="investor-progress-grid">
          <div><span>Live market research surface</span><strong className="complete">Public</strong></div>
          <div><span>Contracts, solver, API and indexer</span><strong className="complete">Built</strong></div>
          <div><span>Local + Polygon fork lifecycle</span><strong className="complete">Validated</strong></div>
          <div><span>Independent security audit</span><strong className="next">Next gate</strong></div>
          <div><span>Controlled capital pilot</span><strong className="planned">Post-audit</strong></div>
          <div><span>Public mainnet capital</span><strong className="planned">Not activated</strong></div>
        </div>
      </section>

      <section className="investor-section investor-raise" id="raise">
        <div className="investor-raise-number"><span>Target round</span><strong>$1M</strong><small>Pre-seed</small></div>
        <div className="investor-raise-copy">
          <p className="investor-kicker">The next proof point</p>
          <h2>Fund the path from audit-ready protocol to controlled capital pilot.</h2>
          <p>The round is intended to finance independent review, production-grade operations and the first tightly bounded deployment—not premature public scale.</p>
          <div className="investor-raise-priorities">
            <span>Independent audit + formal review</span>
            <span>External staging + monitoring</span>
            <span>Controlled pilot liquidity</span>
            <span>Protocol, product + legal execution</span>
          </div>
          <div className="investor-actions">
            <a className="investor-primary-action" href="https://github.com/unrealwandregime/EventClear" target="_blank" rel="noreferrer">Review the engineering <span aria-hidden="true">↗</span></a>
            <a className="investor-secondary-action" href="/app">Open the research app</a>
          </div>
        </div>
      </section>

      <footer className="investor-footer">
        <Link className="investor-brand" href="/"><i className="investor-brandmark" aria-hidden="true" /><span>EventClear</span></Link>
        <p>Provable collateral compression for prediction markets.</p>
        <div><a href="/app">Protocol app</a><a href="https://github.com/unrealwandregime/EventClear" target="_blank" rel="noreferrer">GitHub</a></div>
        <small>Smart contracts are not handling public capital. Independent audit and controlled pilot are pending.</small>
      </footer>
    </main>
  );
}
