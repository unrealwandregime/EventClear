# Quote pre-sign validation

Every initial quote and refresh passes the same fail-closed validation immediately
before nonce allocation and EIP-712 signing.

## Trusted inputs

- SIWE session and configured chain identity
- immutable approved relationship record and reviewed solver definition
- Polygon ERC-1155 balances and CTF payout denominators
- current Gamma metadata, Data API positions and fresh CLOB observations
- deployed relationship registry, funding pool and risk-policy state

Local and test modes use an explicit deterministic ledger with the same
validation boundary. Seeded state is never used by non-local modes.

## Enforced checks

- strict EOA signer, borrower and position-wallet equality
- active `CRYPTO_THRESHOLD_V1` relationship, exact hash/version, complete rule
  hash and valid resolution window
- reproducible solver artifact, positive floor, complete terminal states and
  minimum/maximum witnesses
- exact reviewed condition/token/outcome semantics, no duplicate, negative-risk,
  combo, non-standard, resolved or closed legs
- sufficient RPC balances and agreement with market/position metadata
- fresh CLOB and Gamma observations
- deployed pool/registry/risk bytecode, liquidity and reserve, utilization and
  per-bundle limits
- adapter, collateral and schema allowlists plus wallet, market, relationship,
  global, advance-ratio and duration limits

The artifact timestamp used during validation is reused for the signing run.
The API rejects the request if the artifact hash changes before signing.

Representative rejection codes include:

```text
SIWE_ADDRESS_MISMATCH
POSITION_WALLET_NOT_AUTHORIZED
POSITION_BALANCE_INSUFFICIENT
RELATIONSHIP_SUSPENDED
MARKET_ALREADY_RESOLVED
MARKET_DATA_STALE
POOL_LIQUIDITY_INSUFFICIENT
MARKET_EXPOSURE_LIMIT
BUNDLE_DURATION_EXCEEDED
UNSUPPORTED_NEGATIVE_RISK_POSITION
```

The contracts independently enforce quote identity, exact bundle commitment,
relationship state and version, resolution window, unresolved conditions,
allowlists, exposure limits, duration, liquidity and replay protection.
