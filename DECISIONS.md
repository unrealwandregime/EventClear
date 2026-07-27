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
11. **Standard-market-only mainnet pilot.** Polymarket's public pUSD adapter redeems the caller's entire YES/NO balance for a condition, which is unsafe for a shared vault. EventClear deploys an isolation adapter that pulls only quote-bound token IDs and amounts, redeems them through CTF, and wraps only the resulting USDC.e into pUSD. Negative-risk originations stay disabled until a separate adapter and quote schema are reviewed.
12. **Fees come from realized yield.** The advance is the user's net proceeds and the pool's cost basis. At settlement, proceeds repay cost, the configured fee goes to treasury only from gross yield, and the remainder is LP net yield. Shortfalls pay no fee.
13. **KMS-only production signing.** Local and fork modes may use a development key. Polygon mainnet requires AWS KMS secp256k1 digest signing and recovers every signature against the configured signer address before returning a quote.
