# Polygon mainnet release runbook

EventClear mainnet deployment is a controlled pilot, not a generic production
command. The first release supports standard binary CTF markets only.
Negative-risk originations remain disabled.

## Hard blockers

Do not broadcast or unpause originations until all of the following are true:

- An independent audit covers the exact commit, compiler settings, deployment
  script, standard-market isolation adapter, fee accounting, and KMS signer.
- Audit findings are resolved or explicitly accepted by the governance
  multisig with written rationale.
- Governance, treasury, reviewer, suspender, pauser, risk-admin, and LP-admin
  Polygon multisigs are deployed, tested, and independently verified.
- The AWS KMS secp256k1 signer has rotation, disable, and incident procedures.
- Two independent Polygon RPC providers pass the reviewed manifest check.
- A pinned Polygon fork completes the full open, resolve, redeem, fee, claim,
  shortfall, pause, and replay suite.
- Legal, sanctions/geographic, and pilot-counterparty reviews are complete.

## Release preparation

1. Freeze a release commit and record its full SHA.
2. Build with Solidity `0.8.26`, optimizer `10,000`, and `via_ir=true`.
3. Run Python, TypeScript, Solidity, fuzz, static-analysis, dependency, and
   secret scans.
4. Run `scripts/verify-manifest.ts` with two comma-separated Polygon RPC URLs.
5. Compare every Polymarket dependency against the official contract registry.
6. Simulate `DeployPolygonMainnet.s.sol` against a pinned Polygon fork.
7. Compare deployed bytecode, constructor arguments, role grants, role
   renouncements, caps, signer, and EIP-712 domain.

## Broadcast

The deployment script requires a dedicated, minimally funded deployer and reads
Polymarket dependencies from the reviewed JSON manifest. It:

- deploys the non-upgradeable protocol contracts;
- deploys the exact-leg standard-market redemption adapter;
- assigns every persistent privilege to a reviewed multisig;
- grants the vault, pool, and treasury integration roles;
- pauses new originations;
- removes every deployer privilege in the same broadcast; and
- writes the resulting EventClear address manifest.

Broadcast only from a reviewed offline workstation after an explicit multisig
release approval. Never place the deployer key in application or CI secrets.

## Post-deployment verification

1. Verify source and constructor arguments on the Polygon explorer.
2. Confirm every expected contract has bytecode and every immutable dependency
   matches the reviewed manifests.
3. Reconstruct all `RoleGranted` and `RoleRevoked` events and prove the deployer
   has no remaining role.
4. Confirm `originationsPaused == true`.
5. Confirm the risk signer, pool caps, reserve, utilization limit, treasury,
   and adapter addresses.
6. Exercise a dust-sized allowlisted canary bundle on a reviewed standard
   market; independently reconcile balances and emitted events.
7. Fund the pool only after the canary report is signed.
8. Unpause originations through the emergency-pauser multisig.

## Rollback and incident posture

The vault is non-upgradeable. A failed canary or verification mismatch stops
activation; deploy a corrected version rather than mutating code. After
activation, pause originations immediately on signer compromise, manifest
change, adapter anomaly, solver mismatch, or reconciliation failure.
Settlement and claim redemption must remain available.
