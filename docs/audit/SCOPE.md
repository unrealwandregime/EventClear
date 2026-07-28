# Audit scope

Status: **prepared for independent review; no audit completed**

Audit the final default-branch commit recorded in the release handoff. Contract
scope: `EventClearVault`, `EventClearFundingPool`, `EventClearClaims`,
`EventClearTreasury`, `RiskPolicy`, `RelationshipRegistry`, and
`PolymarketStandardAdapter`, plus interfaces and libraries they import.
Compiler: Solidity 0.8.26 with the settings in
`packages/contracts/foundry.toml`. Also review EIP-712 construction, the Python
solver/preflight/signer boundary, deployment scripts, manifest verification,
and indexer accounting.
