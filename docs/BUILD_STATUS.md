# EventClear Build Status

Last updated: 2026-07-27  
Target release: EventClear v1 controlled, allowlisted production beta  
Current source baseline: `ff1955831bb2be3cea69da8e62096c024656720a`

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
Milestone commit: pending  
Genuinely operational: **Yes for audit/baseline only.**

## Milestone 1 — Deterministic local protocol

Completed:

- Initial Z3 solver and proof verification.
- Initial registry, claims, vault, pool, treasury and standard CTF adapter.
- EIP-712 quote enforcement and local lifecycle tests.
- Principal-first shortfall-safe settlement.

Remaining blockers:

- Canonical semantic model, invalid-market rational handling and mandatory cases.
- Standalone `RiskPolicy.sol`.
- ERC-4626 pool and exposure controls.
- Required adversarial contract tests and invariants.
- Exact requested manifest layout and validation command.

Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 2 — Local full lifecycle

Completed:

- PostgreSQL/Redis/Anvil/API/solver/web Docker Compose scaffold.
- API local store and seed scaffold.

Remaining blockers:

- Automatic deployment and address propagation.
- Indexer service, deterministic seed lifecycle and transaction orchestration.
- API-backed web flow and browser E2E.
- `make demo-lifecycle` and `make test-e2e`.

Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 3 — Live read integration

Completed: official Polygon dependency manifest and SDK dependency.

Remaining blockers:

- Gamma, Data and CLOB clients with validation/cache/retry.
- Wallet-type and capability detection.
- Real position reads and relationship review workflow.
- Removal of non-local fake data.

Relevant commit: pending  
Genuinely operational: **No.**

## Milestone 4 — Polygon fork

Completed:

- Read-only deployed bytecode/interface manifest test.
- Live manifest verification through two RPC providers on 2026-07-27.

Remaining blockers:

- Pinned fork block and real condition/position fixtures.
- Real standard-token transfer into the EventClear vault.
- Redemption-call verification against current deployed contracts.
- `make test-fork`.

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

1. Implement the exact environment manifest layout and startup validation.
2. Complete the canonical threshold model and solver mandatory cases.
3. Add `RiskPolicy.sol`, ERC-4626 accounting and invariant tests.
4. Re-run Milestone 1 acceptance gates and update this file.
