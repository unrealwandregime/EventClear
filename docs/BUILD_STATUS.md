# EventClear Build Status

## Release-blocker validation sprint

Baseline: default-branch commit
`3fb3459761c34301bcfc6b040b170bb3cba74255`, GitHub Actions run
`30278980586`, public Sites version 7. The baseline fork job skipped and is not
reported as passed.

Implemented on `codex/release-blocker-validation`:

- corrected the RiskPolicy collateral getter and added
  `pnpm contracts:check-api-abi`;
- added `make test-api-contract-integration`, which deploys the complete suite
  to a real Anvil process, runs live contract reads and quote preflight, issues
  a signed quote, simulates/submits approval and bundle opening, and checks
  emitted/onchain state;
- added explicit pool accounting fields and invariants for realized-return and
  cumulative book reconciliation;
- configured genuine Polygon fork semantics at block `90963627` and installed
  the repository Actions secret without logging its value;
- added blocking production dependency and license policy plus the single
  expiring development-only advisory exception;
- added a secret-required remote staging deployer, manifest/deployment recorder,
  monitoring assets and incident runbook.

Verified during implementation:

- ABI compatibility: 34 Python read/transaction signatures matched compiled
  ABIs.
- Python solver/API: 49 passed; the dedicated deployed-contract run passed 2.
- Solidity: 35 substantive local/fuzz/invariant tests passed, including 512
  fuzz runs and 24,576 invariant handler calls.
- Polygon fork: 3 genuinely executed tests passed at block `90963627`.
- Indexer: 8 passed.
- Browser lifecycle: 7 passed.
- TypeScript typecheck, production build, dependency policy, license policy and
  local broadcast demo lifecycle passed.

Docker is unavailable on this Windows host. The pushed Linux workflow remains
the source of Docker, Slither, reproducibility and final CI evidence; those
results must not be described as passed until that workflow completes.

External staging: **not operational**. No authenticated external service host,
managed data-store, signer/KMS or monitoring destination was available. No
Polygon mainnet deployment or public capital activation occurred.

Repository administrators configure the fork endpoint without echoing it:

```bash
gh secret set POLYGON_RPC_URL --repo unrealwandregime/EventClear
```

Paste the archive-capable endpoint at the hidden prompt. Never place the value
in workflow YAML, command output, documentation, or a committed environment
file.

Last updated: 2026-07-27  
Target release: EventClear staging-ready v1 for reviewed standard crypto-threshold positions
Sprint baseline: `7d65bb3bf8fd5d714a3c8a536389ebc5f2e76b10`

This is the resumable source of truth. A milestone is operational only when its
acceptance commands and required behavior have been executed.

## State separation

| State | Status |
| --- | --- |
| Software functionality complete | Yes; staging-v1 scope and automated acceptance gates |
| Independent security review complete | No |
| Legal release approved | No |
| Mainnet capital activated | No |
| Public read-only frontend deployed | Yes; Sites version 6 or later, anonymous HTTP 200 verified |

## Staging-v1 continuation sprint

Baseline commit: `7d65bb3bf8fd5d714a3c8a536389ebc5f2e76b10`

In progress:

- Independent professional security review, legal approval and external
  staging infrastructure provisioning.

The public deployment remains `production-readonly`. No EventClear mainnet
contracts or capital have been activated.

Completed in this sprint:

- Quote API session binding enforces SIWE address = borrower = EOA position
  wallet.
- `EventClearVault` enforces transaction sender = borrower = position wallet,
  verifies a separately signed versioned wallet authorization, and consumes its
  nonce in a separate replay domain.
- Adversarial coverage protects previously approved victim wallets and rejects
  modified, expired, replayed, wrong-signer, wrong-chain, wrong-vault and
  different-bundle authorizations.
- Deposit Wallet, Proxy, Safe and unknown contract wallets remain read-only.
- Relationship registry records reviewed earliest/latest resolution timestamps;
  the quote API derives them from the approved relationship and includes them
  in the signed EIP-712 quote.
- `RiskPolicy` measures maximum bundle duration from the latest resolution
  timestamp, independently of the short quote-signature expiry.
- Vault validation rejects modified resolution bounds, already-resolved
  conditions and markets whose latest resolution timestamp has passed.
- Regression coverage proves a five-minute quote can finance a six-month
  market while a two-year market exceeds the configured duration cap.
- The funding pool transfers only net advance, carries gross cost basis and
  excludes pending quoted fees from book assets.
- Origination fees are realized only from financing return actually received;
  unused quoted fees are refunded, and break-even/shortfall paths pay no
  protocol fee.
- Treasury sources remain separate for realized origination fees and the
  protocol share of additional financing return.
- Initial quotes and refreshes now share a fail-closed pre-sign gate covering
  relationship metadata, solver reproducibility, exact reviewed legs, live
  ownership/resolution/market observations, pool liquidity and every configured
  risk limit.
- The solver timestamp checked in preflight is reused for signing, and quote
  issuance aborts if the artifact hash changes between those operations.
- Solver v2 derives terminal regions from normalized reviewed threshold
  predicates with exact rational boundary evaluation, then requires exact
  payout-vector agreement with the independently reviewed truth table.
- Property coverage includes two/three thresholds, mixed sides, unequal
  quantities, strict/inclusive boundaries, fractional states, duplicate
  thresholds, contradictions, missing/extra reviewed regions, reordered
  predicates and modified rule hashes.
- The connected UI now performs Polygon-chain verification, SIWE session
  creation/restoration, wallet-capability discovery, exact position selection,
  server-side analysis, proof download/reproduction, quote confirmation,
  approval receipt confirmation, bundle submission, settlement, claim
  redemption and allowlisted ERC-4626 deposit/withdrawal preparation.
- Transaction state is persisted locally and reconciled with canonical indexed
  events after receipt; bundle, claim and pool views consume indexer read
  models, including transferred claim balances and LP share accounts.
- The indexer projects the complete v1 event surface, rebuilds canonical read
  models after reorg rollback, retries dead letters, and tests duplicate logs,
  restarts, removed logs, reconciliation and multi-contract ordering.
- Playwright covers the successful UI path through indexed bundle opening and
  refresh recovery plus signature rejection, wrong chain, expired quote,
  changed balance, insufficient pool liquidity and reverted transactions.
- The real Polygon fork lifecycle now originates at block `90000000`, advances
  to resolved state at block `90600000`, and completes vault, pool, treasury,
  principal and residual accounting against deployed Polygon dependencies.

## Milestone 0 — Existing repository audit

Scope:

- Inventory the repository and identify retained and replaced components.
- Establish a passing baseline.
- Record architecture decisions and build state.

Completed:

- Created `docs/CURRENT_STATE_AUDIT.md`.
- Created this resumable build tracker.
- Verified the framework, contracts, API, solver, indexer, UI, persistence,
  deployment configuration, mock data and non-functional controls.
- Retained the architecture decision log in `DECISIONS.md`.

Tests executed:

```text
forge test -vv
python -m pytest apps/solver/tests apps/api/tests -q
pnpm typecheck
pnpm lint
pnpm build
node --test tests/rendered-html.test.mjs
```

Results:

- Solidity: 9 passed, 0 failed, including 512 fuzz runs.
- Python: 16 passed, 0 failed.
- TypeScript, lint, build and rendered HTML: passed.
- Exact `make` commands were not executed because GNU Make is unavailable on
  this Windows host; the underlying commands passed.

Remaining blocker: none for the historical audit milestone.
Relevant baseline commit: `ff1955831bb2be3cea69da8e62096c024656720a`  
Milestone commit: `abb12300f689d7b712026c444b366b4858bbb709`
Genuinely operational: **Yes for audit/baseline only.**

## Milestone 1 — Deterministic local protocol

Completed:

- Versioned Z3 solver output and tamper-detecting proof verification.
- Required equal, unequal, reversed, three-threshold, incompatibility,
  fractional-resolution, duplicate, unknown-token and contradiction cases.
- Registry, deterministic claims, ERC-4626 pool, treasury, standard CTF adapter
  and standalone `RiskPolicy`.
- EIP-712 quotes bound to borrower, position wallet, exact bundle, relationship,
  solver artifact, pool, collateral, chain and vault.
- Gross/net advance and quoted origination-fee model (fee timing was
  subsequently replaced by settlement-only realization).
- Per-wallet, market, relationship and global exposure controls.
- Principal-first shortfall-safe settlement.
- Settlement and claim burns remain available while originations/transfers are
  paused.
- Schema-validated, hashed local/fork/mainnet contract manifests.
- Live mainnet manifest verification through two Polygon RPC providers.

Tests executed:

- Python: 22 passed, 0 failed.
- Solidity: 14 passed, 0 failed, including 512 lifecycle fuzz cases.
- Pool invariants: 2 passed over 16,384 handler calls.
- TypeScript typecheck and lint: passed.
- Local manifest verification: passed.
- Polygon-mainnet manifest verification through two providers: passed.

Remaining blockers:

- Complete every listed adversarial contract case, especially malicious
  callbacks, rescue restrictions and withdrawal-bank-run scenarios.
- Move approved-definition loading out of inline solver artifacts and into the
  immutable relationship repository.
- Add complete structured claim metadata.
- Prove exact Make targets in Linux CI.

Relevant commit: `a1fbe7d0b01bc6477d46b7d7fac67cbe0bbce335`
Genuinely operational: **No.**

## Milestone 2 — Local full lifecycle

Completed:

- PostgreSQL/Redis/Anvil/API/solver/web Docker Compose scaffold.
- Durable SIWE sessions, quote nonces, analysis artifacts, audit records and
  normalized protocol/indexer schema.
- Reorg-aware multi-contract indexer with RPC failover health, checkpoints,
  rollback marking, dead letters, backfill, reconciliation and status commands.
- Executable ERC-4626 and claim-redemption transaction preparation.
- API-backed web metrics, scanner, bundle ledger, registry and pool views; no
  production fallback to presentation fixtures.
- Automatic local deployment-address extraction and Compose propagation.
- Broadcast `DemoLifecycle.s.sol` completed successfully on chain 31337 with 30
  successful receipts: reviewed relationship, LP deposit, signed financing,
  escrow, resolution, settlement, principal redemption and residual redemption.
- Final broadcast state independently read from Anvil:
  borrower pUSD `194525000`, pool realized yield `4500000`, outstanding cost
  basis `0`.

Remaining blockers:

- Docker Desktop is unavailable on this host, so the complete Compose topology
  and PostgreSQL migrations still require Linux CI execution.
- Browser wallet E2E and indexer reorg integration tests still need automation.
- The checked `make demo-lifecycle` target is implemented, but GNU Make is not
  installed on this host; its underlying commands passed.

Relevant commit: `ba562d35bb4d0c736c1e2b77dc425e6ebcc335ff`

Genuinely operational: **No.**

## Milestone 3 — Live read integration

Completed: official Polygon dependency manifest and SDK dependency.

Additional completed work:

- Validated Gamma market and Data API position clients with bounded retries,
  timeouts, schema filtering and exact decimal-to-atomic conversion.
- Validated public CLOB orderbook and price-history ingestion against a live
  active token, including exact decimal bounds and monotonic history checks.
- Persisted orderbook observations in the API store and enforced the configured
  freshness window before any non-local quote; CLOB failure is tolerated only
  when a durable cached observation is still fresh.
- Kept the exchange book-mutation timestamp as source-lag telemetry rather than
  incorrectly treating an unchanged but freshly fetched book as stale.
- Polygon RPC failover wallet-code detection and explicit EOA versus unverified
  contract-wallet capabilities.
- Non-local API paths fail closed when reviewed/indexed state is unavailable;
  seeded data is restricted to local/test modes.

Remaining blockers:

- Real reviewed relationship population.
- End-to-end live API verification against production infrastructure.

Relevant commits: `ba562d35bb4d0c736c1e2b77dc425e6ebcc335ff`,
`b7e6bdad525dd399a2b89661757d0cec13076804`

Genuinely operational: **No.**

## Milestone 4 — Polygon fork

Completed:

- Read-only deployed bytecode/interface manifest test.
- Live manifest verification through two RPC providers on 2026-07-27.
- Pinned fork block `90963627` and a captured Gamma standard-market fixture.
- Exact Gamma token IDs reproduced from deployed CTF position derivation.
- Winning position transferred into a fresh EventClear redemption escrow,
  burned through deployed CTF, wrapped through Polymarket's authorized standard
  collateral adapter, and received as exactly `1000000` pUSD atomic units.
- Fork testing caught and removed an invalid direct-pUSD-wrap assumption from
  the original custom adapter design.
- Corrected collateral-adapter addresses against Polymarket's official
  `ctf-exchange-v2` registry; fork and mainnet manifests verify through two RPCs.
- Deployed the complete EventClear registry, claims, treasury, pool, risk policy,
  standard adapter and vault on the pinned fork.
- Financed an exact real resolved position with a signed quote, transferred it
  from the borrower into the vault, redeemed it through deployed Polymarket
  contracts, released exposure, realized principal and financing return in the
  pool, recorded both fee sources, and burned the borrower's residual claim.
- Full fork result: 3 passed, 0 failed (manifest, isolated adapter redemption and
  EventClear vault/pool lifecycle).

Remaining blockers:

- Add a negative-risk read-only fixture while keeping originations disabled.
- Execute the checked `make test-fork` wrapper in Linux CI (the underlying
  pinned command passed on this host).

Relevant commits: `02f26dbd31df85ca8d8670b8fe7c716e09ce6b15`,
`054a2195332aa356f731c617c78640aa92dc9813`

Genuinely operational: **No.**

## Milestone 5 — Staging preparation

Completed:

- Versioned Docker Compose services for frontend, API, solver, indexer,
  PostgreSQL, Redis and local-chain lifecycle verification.
- Staging environment template covering object storage, monitoring, log
  aggregation, signer configuration, multisig-ready administration and a
  controlled LP allowlist.
- Deployment and rollback commands in
  `infrastructure/deployment/STAGING_RUNBOOK.md`.
- Linux CI proves installation, the complete test suite, Docker builds and the
  broadcast local demo lifecycle.

Remaining blockers:

- Provision the external staging environment, secrets, managed data services,
  monitoring destinations and controlled operator allowlist.
- Deploy staging contracts only under the documented operator approval flow.

Genuinely operational: **Prepared but not externally deployed.**

## Milestone 6 — Production read-only

Completed:

- Public Sites frontend deployment with anonymous HTTP 200 verification.
- Polygon dependency manifest and guarded production configuration.
- Same-origin read-only edge endpoints for live Gamma markets and Polymarket
  Data API wallet positions; exact decimal conversion and no signing secrets.
- Empty/unavailable EventClear protocol state is explicit until verified
  contracts and indexed data exist; it is never replaced with seed metrics.
- Anonymous production verification returned HTTP 200 for the site, public
  config, protocol metrics, bundles, relationships, live markets and wallet
  positions. The pool endpoint intentionally returns HTTP 503 until a verified
  EventClear pool address is deployed.

Remaining blockers:

- Relationship review database and live solver analysis.
- Durable production indexer/database and deployed EventClear contracts.

Relevant commit: `c92c0663a7f09e1497e7e8952aee6ece1abaef2a`

Genuinely operational: **No.**

## Milestone 7 — Controlled mainnet beta preparation

Completed:

- Guarded deployment script, KMS signer and preliminary runbook.

Remaining blockers:

- All earlier milestones.
- Independent audit and legal approval.
- Production multisigs, KMS, data services, monitoring and allowlist.
- Verified EventClear deployment and small canary caps.
- All server-side controlled-production gates.
- Resolution of outstanding dependency advisories.

Relevant commit: pending  
Genuinely operational: **No.**

## Current verification snapshot

- Frontend lint, typecheck and build: passed locally.
- Python API/solver: 49 passed locally.
- Indexer: 7 passed locally.
- Playwright: 7 passed locally.
- Solidity local/fuzz/invariant: 33 passed, including 512 fuzz runs and 16,384
  invariant handler calls.
- Polygon fork: 3 passed against a public Polygon archive RPC.
- Docker Compose: not run on this Windows host because Docker is unavailable;
  the Linux GitHub runner passed Docker builds, `make install`, `make test` and
  `make demo-lifecycle`.
- GitHub Actions: all required jobs passed on `main` for
  `25e7e0557d95dca47becf1c1d8b7279140eafb0f`
  ([run 30278064053](https://github.com/unrealwandregime/EventClear/actions/runs/30278064053)).
- Public deployment: Sites version 6 or later succeeded and anonymous checks returned
  HTTP 200 for the page, public config and protocol metrics.

## Next actionable work

1. Complete independent professional security and legal review.
2. Provision the external staging data, signing and monitoring services.
3. Configure production multisigs, KMS, monitoring and a controlled allowlist.
4. Resolve outstanding non-critical dependency advisories.
5. Keep public capital disabled until every activation gate is independently
   approved.
