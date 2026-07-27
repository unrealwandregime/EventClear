# EventClear Current-State Audit

Audit date: 2026-07-27  
Baseline commit: `ff1955831bb2be3cea69da8e62096c024656720a`  
Target: EventClear v1 controlled, allowlisted production beta for `CRYPTO_THRESHOLD_V1`

## Executive assessment

The repository is a coherent release-candidate prototype, not a complete EventClear
v1. It already contains a deterministic Python solver, EIP-712 quote generation,
working local Solidity lifecycle tests, a PostgreSQL-oriented API repository,
a minimal indexer, a functional responsive interface, and a verified Polygon
dependency manifest. The strongest retained foundation is the contract lifecycle:
positions are escrowed, an advance is funded, principal and residual claims are
minted, settlement is principal-first, and shortfalls do not consume unrelated
pool assets.

The principal gaps are operational integration and completeness. The web
application reads hard-coded arrays instead of the API/indexer, the API exposes
only part of the required `/api/v1` surface, live Polymarket ingestion is absent,
the indexer handles one event and does not implement reorg rollback, the pool is
not ERC-4626, there is no standalone `RiskPolicy`, local orchestration lacks an
automatic deploy/seed/lifecycle command, and the existing fork test validates
manifest interfaces without exercising real token escrow or redemption calldata.

No component is independently audited. No public-mainnet EventClear transaction
has been broadcast.

## Framework and package structure

| Area | Current implementation | Assessment |
| --- | --- | --- |
| Web | Vinext/Next-compatible React 19 application in `app/`; TypeScript strict mode | Retain visual system and routing shell; replace hard-coded state |
| API | FastAPI/Python 3.12 in `apps/api` | Retain service; expand schemas, routes, authorization, persistence, live clients |
| Solver | FastAPI/Python 3.12, Pydantic, Z3 in `apps/solver` | Retain and extend canonical v1 semantics and proof format |
| Indexer | TypeScript/Viem/PostgreSQL in `apps/indexer` | Retain scaffold; replace single-event loop with reorg-aware event pipeline |
| Contracts | Solidity 0.8.26, Foundry, OpenZeppelin 5.4 in `packages/contracts` | Retain lifecycle core; add missing risk/pool/adapter guarantees and coverage |
| Shared packages | `packages/config`, `packages/sdk`, `packages/shared` | Retain; normalize schemas and production gates here |
| Persistence | PostgreSQL SQL migrations plus API read models | Retain PostgreSQL; complete normalized tables and transactional repositories |
| Local infrastructure | Docker Compose for PostgreSQL, Redis, Anvil, solver, API, web | Retain; add deployer, seeder, indexer and deterministic lifecycle runner |
| Hosting | ChatGPT Sites/Vinext deployment metadata | Retain for the public read-only frontend |

## Frontend routes and components

The application has one route, `/`, rendered by `app/page.tsx`. The primary
interface is the client component `app/components/EventClearApp.tsx`, with five
in-component sections: Overview, Scanner, Bundles, Pool and Registry.

The navigation, layout, typography, responsive CSS, wallet connection prompt,
quote drawer and state-specific panels can be retained. The monolithic component
must be decomposed as live queries and transaction state are introduced, without
changing the established visual identity.

There are no bundle-detail, analysis-detail or admin routes. There is no
recoverable transaction state, query cache integration, error boundary, live
API client, artifact download, transaction receipt tracking, or contract-write
integration.

## Existing mock and preview data

The following are simulated or seeded:

- Frontend opportunity rows for BTC, ETH and an unsupported election example.
- Overview metrics: `482,640.00`, `451,268.40`, `61.8%`, and `24`.
- Active bundle `EC-00418`, all bundle-ledger rows, pool balances and returns.
- Scanner balances, market values, rule matches, solver hashes and quote values.
- Registry entries, review states and abbreviated hashes.
- API `seed.py` markets, positions, relationships and bundle `EC-00418`.
- API pool, pool history and protocol metrics responses.
- API rule-document response and eligible-bundle response.
- Settlement preparation response.

Seed data is acceptable only in `local` and `test`. It must be explicitly labeled
as seeded. It must never be returned in fork, staging, production-readonly or
production-controlled environments.

## Existing APIs

Implemented:

- Health, public configuration, SIWE nonce and verification.
- Market and market-rule reads.
- Seeded position and eligible-bundle reads.
- Solver analysis, quote creation/read and bundle reads.
- Settlement preparation stubs.
- Relationship reads and limited administrative transitions.
- Seeded pool, history and protocol metrics.
- Prometheus `/metrics`.

Missing or incomplete:

- Readiness dependency checks, logout and authenticated session reads.
- Market snapshots, wallet detection/capabilities/opportunities.
- Versioned analysis persistence, artifact download and verification routes.
- Quote refresh and pre-sign ownership/liquidity/exposure revalidation.
- Bundle transactions, genuine settlement transaction preparation.
- Claims, pool-account and pool transaction preparation routes.
- Complete relationship extract/review/approve/suspend/retire workflow.
- Risk-policy API, protocol event API, CSRF strategy and idempotency handling.
- Complete typed request/response models and structured error envelope.

SIWE validates domain, URI, version, chain, nonce, timestamps and recovered
address. Production rate limiting fails closed when Redis is unavailable.

## Existing contracts

Implemented:

- `RelationshipRegistry.sol`
- `EventClearClaims.sol`
- `EventClearVault.sol`
- `EventClearFundingPool.sol`
- `EventClearTreasury.sol`
- `PolymarketStandardAdapter.sol`
- local pUSD, CTF, adapter and resolution mocks
- local and guarded Polygon-mainnet deployment scripts

Working behavior includes EIP-712 quote verification, nonce replay protection,
relationship activity checks, exact ERC-1155 escrow, advance funding, principal
and residual claim minting, permissionless settlement, principal-first
allocation, partial redemption, shortfall recording, pause controls and exact
standard-position redemption isolation.

Material gaps:

- Funding pool is not ERC-4626 and has no transferable pool shares.
- No standalone `RiskPolicy.sol`; caps are limited and distributed.
- No per-wallet, per-market or per-relationship exposure accounting.
- Claims expose no structured metadata.
- Contract suite lacks the full adversarial/invariant matrix in the v1 mandate.
- Adapter naming differs from the required `PolymarketStandardCTFAdapter`.
- Rescue restrictions and malicious callback tests are incomplete.
- Mainnet deployment is intentionally blocked and writes zero-address
  EventClear output until explicitly run.

## Wallet integration

The web application supports EIP-1193 account connection and reads chain ID.
It does not detect EOA, Deposit Wallet, Proxy or Safe position-holding accounts,
does not use SIWE, does not query ERC-1155 balances or approvals, and does not
prepare or submit any contract transaction.

Only EOA-held standard CTF positions may be considered an execution target for
v1 until automated capability tests prove additional wallet paths. Other wallet
types must remain read-only.

## Deployment configuration

Present:

- Docker Compose and container Dockerfiles.
- Local Foundry deployment script.
- Guarded Polygon-mainnet deployment script.
- Polygon dependency manifest and read-only verifier.
- Sites production deployment metadata.
- Environment example and mainnet runbook.

Missing:

- Required environment taxonomy and full controlled-production gate set.
- Staging and production container/orchestration definitions.
- Object storage, monitoring and alert deployment configuration.
- Multisig, signer, settlement, incident and environment-specific runbooks.
- Explorer verification automation and complete deployment records.

## Tests and baseline

Executed on 2026-07-27:

- Foundry: 9 passed, 0 failed; includes 512 fuzz runs.
- Solver and API: 16 passed, 0 failed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Vinext production build: passed.
- Rendered HTML test: passed.

The local Windows host does not expose GNU Make, so the current `make` acceptance
commands cannot run verbatim here. Their underlying commands pass. CI/Linux and
developer tooling must still prove the exact Make targets.

Coverage gaps include contract invariants, malicious callbacks, indexer tests,
browser E2E, live Polymarket client tests, local multi-service lifecycle, and a
pinned Polygon-fork transaction lifecycle.

## Non-functional transaction controls

- Overview “Analyze bundle” opens a local drawer only.
- Scanner selection does not query balances or run the API solver.
- “Review quote” opens a local drawer only.
- Quote action dismisses the drawer; it does not submit a transaction.
- “Prepare settlement” has no click handler.
- “Deposit on Polygon” has no click handler.
- No claim-redemption action exists.
- No approval, bundle-open, receipt, replacement or refresh recovery flow exists.

## Components to retain

- Sidebar/topbar navigation and visual identity.
- Responsive panel, table, drawer, metric and status styles.
- EIP-1193 connection entry point as the base for Wagmi/Viem.
- FastAPI service boundary and SIWE/KMS primitives.
- Z3 solver service boundary and canonical hashing concept.
- PostgreSQL and Redis infrastructure.
- Contract lifecycle and exact-position standard adapter.
- Viem indexer scaffold and idempotent chain-event key.
- Polygon manifest verification logic.

## Components to replace or materially extend

- Hard-coded frontend arrays and all simulated live metrics.
- Monolithic frontend data/transaction logic.
- API seed responses outside local/test.
- Generic JSON read-model persistence for financial records.
- Single-event indexer and placeholder reconciliation.
- Pool implementation with a complete allowlisted ERC-4626 design.
- Distributed risk checks with a dedicated onchain `RiskPolicy`.
- Minimal manifest layout with environment-specific schema-validated manifests.
- Incomplete Makefile, CI, E2E, fork lifecycle and operational documentation.

## Technical debt and blockers

1. One high-severity `brace-expansion` advisory remains in development tooling;
   a global override is incompatible with the older minimatch API.
2. The current repository uses Vinext `0.0.x`; framework/toolchain stability must
   be monitored.
3. No independent security or legal review exists.
4. No production multisig, KMS key, managed PostgreSQL/Redis, object storage,
   monitoring or funded canary account is configured.
5. Live Polymarket market/position data has not been exercised end-to-end.
6. The Polygon fork test validates deployed interfaces but not real-holder escrow.
7. Some source files contain mojibake characters that must be normalized.

## Operational conclusion

Milestone 0 has a passing technical baseline once this audit and
`docs/BUILD_STATUS.md` are committed. Milestones 1–7 remain incomplete. The
current public site is a product interface and read-only release candidate; it
must not be represented as a capital-enabled protocol.
