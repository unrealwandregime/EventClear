# Decisions

1. **Fail-closed mainnet.** Mainnet configuration uses official registry addresses, but execution remains gated by five server-side safety variables and live bytecode/interface verification.
2. **Exact atomic accounting.** Protocol, API, solver, and database quantities use integers or `numeric(78,0)`; no guaranteed-floor path uses floating point.
3. **Explicit terminal worlds.** Reviewed definitions persist complete payout vectors, including fractional/cancellation states. This makes proofs reproducible and prevents hidden semantic defaults.
4. **SHA-256 offchain, `bytes32` onchain.** Canonical JSON artifacts use stable sorted-key SHA-256. The exact 32-byte digest is registered and quoted.
5. **Immutable definitions and vault.** Approved definitions cannot mutate; replacements increment version. The pilot vault is non-upgradeable.
6. **Pool values advances at cost.** Outstanding principal claims are represented by advance cost basis until settlement, preventing premature yield recognition.
7. **Residual supply equals principal units.** This gives exact pro-rata partial residual redemption without iterating claim owners.
8. **Official unified SDK.** Market and wallet integration targets `@polymarket/client`; direct Viem is reserved for EVM verification/transactions.
9. **FastAPI services.** Solver and protocol API are separately deployable Python 3.12 services. The API imports the same solver library locally so quote issuance always reruns identical code.
10. **Seeded local UI.** The public preview is immediately usable without a wallet or infrastructure. It is explicitly illustrative and cannot create a capital-bearing quote.
