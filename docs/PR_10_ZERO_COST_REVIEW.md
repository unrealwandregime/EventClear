The owner has no cloud budget. This PR makes **zero-cost `testnet-prototype` the canonical executable prototype path** and retains AWS as optional future funded staging. The public investor/research deployment remains production-readonly.

The prototype uses one supervised container for web/API/solver/indexer, persistent PostgreSQL and TLS Redis, a dedicated isolated local risk signer, immutable content-addressed PostgreSQL proofs, provider-neutral test-chain/lifecycle automation and free monitoring. Mode guards reject mainnets/local chain IDs, development keys, actor collisions, missing allowlists, weak secrets and any nonzero prototype cost ceiling. Funded staging keeps KMS/S3/security requirements.

`render.yaml` specifies a free service and provider hostname; no code creates a paid resource or upgrades a plan. The redeploy adapter verifies an existing service is free and pins the immutable SHA. Current Render/Neon/Upstash free-plan terms/account eligibility could not be verified from the cloud runtime, so those providers remain candidates rather than a claimed running deployment.

Validation:

- Existing Solidity, API, solver, indexer, ABI, browser, Linux reproducibility, dependency/license, Gitleaks, Slither and container checks are retained.
- Prototype safety, signer isolation, real PostgreSQL artifact immutability/tamper detection, migration repeatability and supervisor failure tests were added.
- The shared disposable-chain lifecycle verifies LP liquidity, SIWE, proof reproduction/storage, signed quote, approvals, financing, indexing, restart persistence, settlement, both redemptions and exact onchain/indexed accounting. An unavailable Redis rejects startup. This is local/CI evidence, not remote-testnet acceptance.
- Pool snapshots now use the indexed block and reconcile event-derived accounting before committing checkpoints. All six runtime images are scanned. The initial Debian 12 critical findings were fixed by using matching Debian 13 bases.
- Every remaining Slither finding has an internal disposition in `docs/SLITHER_FINDING_REVIEW.md`; an independent audit remains incomplete. Polygon fork execution depends on the existing RPC binding; a conditionally skipped branch check is not new fork evidence.

**External status: NOT DEPLOYED / NOT REMOTELY ACCEPTED.** Free owner-controlled accounts, provider bindings, dedicated wallet secrets and faucet gas are missing. No external contract address, transaction, URL, bundle, accounting reconciliation, service restart, provider revision rollback or alert delivery is fabricated. AWS is not required. No real funds, mainnet deployment or public LP/capital activation is authorized.

See `docs/BUILD_STATUS.md` for the current evidence ledger, `docs/ZERO_COST_DEPLOYMENT.md` for the owner checklist and ordered commands, and `docs/TESTNET_PROTOTYPE_EVIDENCE.md` for actual remote status. No evidence is pushed directly to master. Legal approval and independent audit remain later capital-release requirements.
