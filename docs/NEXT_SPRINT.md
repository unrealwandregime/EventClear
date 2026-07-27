# EventClear staging-v1 sprint

Baseline: `7d65bb3bf8fd5d714a3c8a536389ebc5f2e76b10`

## Security-critical

- [x] Enforce SIWE signer = borrower = EOA position wallet = transaction sender.
- [x] Bind a versioned, non-replayable position-wallet authorization hash.
- [x] Keep unverified Deposit Wallet, Proxy and Safe paths read-only.
- [x] Commit reviewed resolution timestamps in registry and signed quotes.
- [x] Enforce maximum duration from latest resolution, never quote expiry.
- [x] Realize quoted origination fees only from successful financing return.
- [x] Pay no protocol fee on break-even or shortfall settlement.
- [x] Revalidate relationship, proof, balances, market state, liquidity and risk
      immediately before quote signing.
- [ ] Generate crypto-threshold worlds from reviewed predicates and compare the
      generated set with the reviewed truth table.

## Connected lifecycle

- [ ] Connect wallet, switch Polygon, SIWE authenticate and resolve capabilities.
- [ ] Select exact indexed legs and submit deterministic analysis.
- [ ] Download and independently verify the canonical proof artifact.
- [ ] Request a live signed quote with explicit user confirmations.
- [ ] Confirm ERC-1155 approval receipt and open the exact bundle.
- [ ] Recover pending transaction state after refresh.
- [ ] Prepare and submit settlement from verified indexed resolution state.
- [ ] Redeem partial/full principal and residual claims.
- [ ] Source bundle, claim and pool views from indexed contract state.

## Verification and operations

- [ ] Add adversarial contract/API/solver/indexer regression coverage.
- [ ] Add Playwright local lifecycle and failure-path coverage.
- [ ] Run local Foundry, Python, TypeScript, indexer and browser checks.
- [ ] Run Docker Compose lifecycle on a Docker-capable Linux runner.
- [ ] Run the pinned Polygon-fork lifecycle with the new security model.
- [ ] Make required GitHub Actions jobs visible and green.
- [ ] Prepare read-only staging manifests without broadcasting mainnet contracts.
- [ ] Keep the public deployment labeled `Public read-only alpha`.

## Explicitly out of scope

- Negative-risk financing, combo positions, leverage or trading.
- Election, sports or unrelated market categories.
- Public LP deposits or public capital execution.
- Polygon-mainnet EventClear deployment without a separate explicit approval.
