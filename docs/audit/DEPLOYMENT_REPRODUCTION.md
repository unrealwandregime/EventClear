# Deployment reproduction

Checkout the exact audited SHA with a clean worktree, run the required commands
in `README.md`, and preserve CI and Slither artifacts. For staging, provision
resources through `docs/AWS_STAGING_SETUP.md`, configure the protected GitHub
`staging` environment, dispatch the preflight, and separately approve the
contract action. Run `DeployStaging.s.sol`, then
`pnpm deployment:record-staging` and `pnpm contracts:verify-manifest`.

Reproduction must compare compiler version, constructor arguments, bytecode
hashes, role assignments, risk limits, relationship/rule hashes, manifest hash,
image digests and final Git SHA. Polygon chain ID 137 is prohibited.
