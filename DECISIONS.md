# Decisions

## 2026-07-27 — EventClear v1 completion boundary

- The only financing schema authorized in v1 is `CRYPTO_THRESHOLD_V1`.
- EOA-held standard binary CTF positions are the minimum executable wallet
  target. Deposit Wallet, Proxy and Safe remain read-only until automated
  capability tests prove approval and exact ERC-1155 transfer behavior.
- Seed data is permitted only in `local` and `test`; live modes fail rather than
  silently substituting demonstrations.
- Software completion, independent security review, legal approval and capital
  activation are separate release states.
- The existing visual identity, FastAPI boundary, Python/Z3 solver, PostgreSQL,
  Viem indexer scaffold and immutable contract architecture remain the
  implementation foundation.

## Existing decisions

1. **Fail-closed mainnet.** Mainnet configuration uses official registry addresses, but execution remains gated by thirteen server-side safety variables and live bytecode/interface verification.
2. **Exact atomic accounting.** Protocol, API, solver, and database quantities use integers or `numeric(78,0)`; no guaranteed-floor path uses floating point.
3. **Explicit terminal worlds.** Reviewed definitions persist complete payout vectors, including fractional/cancellation states. This makes proofs reproducible and prevents hidden semantic defaults.
4. **SHA-256 offchain, `bytes32` onchain.** Canonical JSON artifacts use stable sorted-key SHA-256. The exact 32-byte digest is registered and quoted.
5. **Immutable definitions and vault.** Approved definitions cannot mutate; replacements increment version. The pilot vault is non-upgradeable.
6. **Pool values advances at cost.** Outstanding principal claims are represented by advance cost basis until settlement, preventing premature yield recognition.
7. **Fixed residual-share supply.** Each bundle mints `1e18` residual shares. Last-claim redemption receives deterministic division dust without iterating claim owners.
8. **Official unified SDK.** Market and wallet integration targets `@polymarket/client`; direct Viem is reserved for EVM verification/transactions.
9. **FastAPI services.** Solver and protocol API are separately deployable Python 3.12 services. The API imports the same solver library locally so quote issuance always reruns identical code.
10. **Seeded data is local-only.** Local/test modes expose deterministic lifecycle fixtures. Non-local frontend and API paths fail closed or report unavailable when no verified source exists.
11. **Standard-market-only mainnet pilot.** Polymarket's official pUSD adapter is the authorized wrapper and redeems the caller's entire YES/NO balance for a condition. EventClear moves only quote-bound amounts into a fresh per-redemption escrow, then delegates each condition to that official adapter. This preserves bundle isolation and the authorized pUSD path. Negative-risk originations stay disabled until a separate adapter and quote schema are reviewed.
12. **Separated fee sources (superseded by decision 17).** Origination
    and realized-return fees remain separately attributable in treasury
    accounting.
13. **KMS-only production signing.** Local and fork modes may use a development key. Polygon mainnet requires AWS KMS secp256k1 digest signing and recovers every signature against the configured signer address before returning a quote.

14. **Strict EOA execution identity.** The first execution-capable release
    requires the authenticated SIWE signer, borrower, position wallet and
    transaction sender to be the same address. Smart-wallet types remain
    read-only until an official controlling-signer path is verified and tested.
15. **Separate wallet-authorization domain.** Quotes commit to a versioned
    position-wallet authorization hash. Its nonce, expiry, chain, vault,
    borrower and exact bundle are independent of the financing quote nonce.
16. **Resolution duration is reviewed metadata.** Earliest and latest
    resolution timestamps belong to the immutable relationship definition and
    signed quote. Quote expiry controls signature validity only.
17. **Settlement-only fee realization.** The quoted origination fee is retained
    inside the gross pool cost basis and may be paid only from financing return
    actually received at settlement. Any unearned portion is returned to the
    borrower. Break-even and shortfall settlements pay no protocol fees.
18. **Canonical post-transaction reads.** A wallet receipt confirms chain
    inclusion, not application state. The UI retains recoverable transaction
    stages and waits for the indexer to project escrow, funding, claims,
    settlement and redemption events before presenting indexed confirmation.
19. **Historical fork transition.** The fork lifecycle originates while the
    reviewed condition is unresolved at Polygon block `90000000`, then advances
    to resolved block `90600000`. EventClear contracts remain persistent across
    the fork transition; injected escrow is restored after the fork roll because
    the external CTF account must remain non-persistent to observe real
    resolution state.
20. **Public surface remains read-only.** The Sites deployment may expose live
    market and position reads, but quote signing and all capital writes remain
    disabled in `production-readonly`, independently of frontend controls.
21. **Explicit pool return ledger.** Gross financing return, LP yield,
    origination fees, protocol yield fees, borrower refunds and losses are
    separate cumulative fields. The onchain book identity reconciles deposits,
    withdrawals, LP yield and loss; the ambiguous `realizedYield` field is
    removed.
22. **Staging is a distinct trust boundary.** `EVENTCLEAR_MODE=staging` uses a
    staging manifest and rejects the repository development signer, weak admin
    credentials, missing durable stores, absent LP allowlist and missing RPC
    fallback. A deployment template or CI Anvil run is not external staging.
23. **Release security semantics are scope-aware.** High/critical production
    dependency findings and disallowed licenses block. A development-only high
    advisory requires a narrow, owned, expiring exception.

## Release-blocker validation sprint

Software checks are reported independently from remote operations. External
staging remains incomplete until remote health URLs, contract transactions,
lifecycle evidence and active monitoring can be verified. Polygon mainnet
deployment and public capital activation remain prohibited.

## 2026-07-28 — External staging provider

- **Selected: AWS.** No container/cloud provider was authenticated. AWS is the
  first priority option that satisfies the complete requirement set with
  ECS/Fargate, RDS PostgreSQL, ElastiCache Redis, S3 encryption and versioning,
  KMS secp256k1 signing, Secrets Manager, CloudWatch, ACM and Route 53.
- **Railway rejected for this release boundary.** Its managed application
  workflow is simpler, but its native object-storage documentation does not
  currently guarantee the required server-side encryption and versioning
  controls, and its database services leave more operational ownership with
  the project.
- **Render and Fly.io not selected.** Neither was already connected, so adding
  another provider would not remove the credential boundary or simplify the
  AWS-native KMS/S3/monitoring requirements.
- **Limitations.** AWS requires an account, OIDC role, network, DNS and
  notification destination that are not available in this environment.
  Therefore the architecture is selected and documented, but no AWS resource
  is claimed as provisioned.
- **Recurring resource categories.** Four Fargate application services, one
  persistent staging-chain service plus encrypted state, an application load
  balancer, private networking/NAT, RDS PostgreSQL, ElastiCache Redis, S3,
  KMS, Secrets Manager, CloudWatch logs/metrics/alarms, Route 53/ACM, backups
  and data transfer. Prices are intentionally not estimated without an
  approved region and sizing exercise.
