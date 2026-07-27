# EventClear Build Status

Last updated: 2026-07-27  
Target release: EventClear v1 controlled, allowlisted production beta  
Current source baseline: `a1fbe7d0b01bc6477d46b7d7fac67cbe0bbce335`

This is the resumable source of truth. A milestone is operational only when its
acceptance commands and required behavior have been executed.

## State separation

| State | Status |
| --- | --- |
| Software complete | No |
| Independent security review complete | No |
| Legal release approved | No |
| Mainnet capital activated | No |
| Public read-only frontend deployed | Yes, Sites version 3 |

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

Remaining blocker: commit this milestone and record the resulting hash.  
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
- Gross/net advance and upfront origination-fee model.
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

Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 3 — Live read integration

Completed: official Polygon dependency manifest and SDK dependency.

Additional completed work:

- Validated Gamma market and Data API position clients with bounded retries,
  timeouts, schema filtering and exact decimal-to-atomic conversion.
- Polygon RPC failover wallet-code detection and explicit EOA versus unverified
  contract-wallet capabilities.
- Non-local API paths fail closed when reviewed/indexed state is unavailable;
  seeded data is restricted to local/test modes.

Remaining blockers:

- CLOB orderbook and price-history ingestion.
- Persistent cache/freshness enforcement and real reviewed relationship
  population.
- End-to-end live API verification against production infrastructure.

Relevant commit: pending  
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

Remaining blockers:

- Extend the fork scenario through the complete EventClear vault financing
  lifecycle rather than adapter-level escrow/redemption only.
- Add a negative-risk read-only fixture while keeping originations disabled.
- Execute the checked `make test-fork` wrapper in Linux CI (the underlying
  pinned command passed on this host).

Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 5 — Staging deployment

Completed: none.  
Remaining blockers: staging infrastructure, contracts, monitoring, multisig,
verification and runbooks.  
Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 6 — Production read-only

Completed:

- Public Sites frontend deployment.
- Polygon dependency manifest and guarded production configuration.

Remaining blockers:

- Live backend and scanner.
- Production state free of mock records.
- Relationship review database and live solver analysis.

Relevant commit: pending  
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

## Next actionable work

1. Run the Compose topology and migrations on a Docker-capable host.
2. Add browser wallet E2E and indexer reorg integration coverage.
3. Complete CLOB/history ingestion and immutable relationship-repository solver
   loading.
4. Pin and execute the Polygon fork lifecycle with real position fixtures.
