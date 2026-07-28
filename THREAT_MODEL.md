# Threat model

| Threat | Primary controls | Residual risk |
|---|---|---|
| Shared-vault over-redemption | Exact-leg isolation adapter, token-ID derivation, duplicate-condition rejection, zero post-redemption balances | Unsupported negative-risk markets remain disabled |
| Fee overcharge | Fee capped to realized gross yield and cleared once per bundle | Incorrect quote economics before signature |
| Incorrect logical relationship | Reviewed canonical definition, exact rule hashes, immutable versions, witness worlds | Reviewer may formalize rules incorrectly |
| Incorrect/stale market metadata | Official SDK, freshness limit, backend revalidation | Upstream data may be wrong |
| Resolution-rule changes | Content hashes, new relationship version, suspension | Ambiguous source changes |
| Independent cancellation | Explicit cancellation worlds; incomplete semantics reject | Unprecedented resolution behavior |
| Fractional payouts | Integer payout numerators in all valid worlds | Incorrect reviewed numerator |
| Quote tampering/replay | EIP-712 wallet/chain/vault/bundle binding, expiry, nonce | Signer compromise |
| Signature theft | Five-minute maximum lifetime, one account and nonce | Theft before use |
| Risk signer compromise | Remote KMS/HSM, role rotation, origination pause, exposure caps | Valid malicious quotes within caps |
| ERC-1155 callback reentrancy | Reentrancy guard, CEI, exact supported token contract | Malicious configured token |
| Oracle delay/adapter failure | Permissionless retryable settlement, no maturity assumption | Funds remain illiquid |
| RPC inconsistency | Multiple RPCs, confirmations, reconciliation | Correlated provider failures |
| Indexer reorg | Confirmation threshold, block hashes, idempotent event keys | Deep reorg |
| Smart-wallet authorization error | Official Secure Client, client-side signature, displayed identities | Wallet implementation upgrade |
| Pool insolvency | Proven floor, haircuts, per-axis caps, no gap concealment, shortfall state | Formal-model failure |
| Admin key compromise | Multisig roles, separated powers, audit log, pause | Multisig signer compromise |
| Frontend substitution | Typed-data review, contract address manifest, server-side gates | DNS/build-pipeline compromise |
| Decimal error | Six-decimal atomic integers and fuzz/property tests | External token metadata changes |
| Double settlement/claim | State transition before external calls, claim burn, nonces | Undiscovered contract bug |
| Malicious token rescue | No active-collateral rescue path in MVP | Accidental unrelated tokens remain stuck |
| Staging access bypass | SIWE-bound tester allowlist, separate admin token/address allowlist, EOA-only execution, provider access control | Compromised allowlisted identity |
| Solver artifact mutation | Canonical SHA-256, create-only object key, private encrypted/versioned S3, retrieval hash check | AWS/IAM compromise or loss of all versions |
| Public/staging confusion | Separate deployment, mode and secrets; public catch-all write rejection; no staging metrics or addresses in Sites | DNS or deployment-pipeline compromise |

Settlement remains callable when new originations are paused. A shortfall allocates all proceeds to principal, zero to residual, and never draws unrelated pool assets.

Production quote signing uses AWS KMS digest signing. Signatures are normalized
to low-s form and recovered against the configured signer; mainnet refuses the
local-key backend.
