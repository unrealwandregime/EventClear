# Contract inventory

| Contract | Purpose |
| --- | --- |
| `EventClearVault` | Quote validation, escrow, funding, settlement |
| `EventClearFundingPool` | Allowlisted ERC-4626 liquidity and cost-basis accounting |
| `EventClearClaims` | Principal and residual ERC-1155 claims |
| `EventClearTreasury` | Separated fee accounting and withdrawal |
| `RiskPolicy` | Signer, allowlists, caps and exposure |
| `RelationshipRegistry` | Immutable reviewed relationship metadata |
| `PolymarketStandardAdapter` | Exact standard CTF redemption and pUSD wrapping |

Mocks are test/staging-only and must not be treated as production dependencies.
Deployment addresses are out of scope until a real manifest is generated.
