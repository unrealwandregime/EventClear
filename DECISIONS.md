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
12. **Separated fee sources.** The pool advances gross principal at cost, sends the upfront origination fee to treasury, and sends net advance to the borrower. At settlement, a separately configured share of realized financing return goes to treasury; shortfalls pay no realized-return fee.
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
    actually received at settlement. Break-even and shortfall settlements pay
    no protocol fees.
