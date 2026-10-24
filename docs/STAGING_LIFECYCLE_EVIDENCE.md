# Staging lifecycle evidence

Status: **NOT RUN REMOTELY**

The local API-to-Anvil tests, local full lifecycle and local staging deployment
are genuine local evidence only. The remote runner is
`scripts/run-remote-staging-lifecycle.mjs`; its protected workflow also runs the
remote UI, restart/Redis/S3/rollback and public isolation checks.

This record is replaced only after successful actual remote execution. It must
contain the Git SHA, region, chain, manifest/signer, proof/analysis/quote IDs,
real test-asset transaction hashes, bundle, settlement/redemptions, accounting,
checkpoint and restart results, and UTC timestamps. No secret values belong here.
