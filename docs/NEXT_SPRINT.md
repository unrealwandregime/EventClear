# EventClear staging-v1 sprint

## Release-blocker validation sprint

- [x] Correct `allowedCollaterals(address)` and add compiled ABI verification.
- [x] Add a dedicated real-Anvil API/contract test command and rejection matrix.
- [x] Replace ambiguous pool yield metrics with an explicit reconciled ledger.
- [x] Make fork-secret and dependency/license CI outcomes blocking and explicit.
- [x] Add fail-closed staging deployment, manifest-recording and monitoring
  configuration.
- [ ] Provision an externally reachable staging host and managed services.
- [ ] Deploy staging contracts and commit the generated staging manifest.
- [ ] Run and record the complete remote lifecycle and monitoring drill.
- [ ] Obtain independent security review and legal approval.

The unchecked items require external credentials or third-party approvals; no
mainnet activation is implied.

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
- [x] Generate crypto-threshold worlds from reviewed predicates and compare the
      generated set with the reviewed truth table.

## Connected lifecycle

- [x] Connect wallet, switch Polygon, SIWE authenticate and resolve capabilities.
- [x] Select exact indexed legs and submit deterministic analysis.
- [x] Download and independently verify the canonical proof artifact.
- [x] Request a live signed quote with explicit user confirmations.
- [x] Confirm ERC-1155 approval receipt and open the exact bundle.
- [x] Recover pending transaction state after refresh.
- [x] Prepare and submit settlement from verified indexed resolution state.
- [x] Redeem partial/full principal and residual claims.
- [x] Source bundle, claim and pool views from indexed contract state.

## Verification and operations

- [x] Add adversarial contract/API/solver/indexer regression coverage.
- [x] Add Playwright local lifecycle and failure-path coverage.
- [x] Run local Foundry, Python, TypeScript, indexer and browser checks.
- [ ] Run Docker Compose lifecycle on a Docker-capable Linux runner.
- [x] Run the pinned Polygon-fork lifecycle with the new security model.
- [ ] Make required GitHub Actions jobs visible and green.
- [x] Prepare read-only staging manifests without broadcasting mainnet contracts.
- [x] Keep the public deployment labeled `Public read-only alpha`.

## Explicitly out of scope

- Negative-risk financing, combo positions, leverage or trading.
- Election, sports or unrelated market categories.
- Public LP deposits or public capital execution.
- Polygon-mainnet EventClear deployment without a separate explicit approval.
