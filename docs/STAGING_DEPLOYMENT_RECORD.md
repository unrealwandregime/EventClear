# Staging deployment record

Status: **NOT DEPLOYED — external host credentials unavailable**

No externally reachable staging chain or service platform is authenticated in
the current execution environment. No addresses or transaction hashes are
fabricated. After an approved remote chain-id 31337 endpoint is provisioned,
run `DeployStaging.s.sol`, then `pnpm deployment:record-staging`; the recorder
replaces this file with the deployment timestamp, Git commit, compiler,
manifest hash, checksummed addresses, bytecode hashes and deployment
transactions.

No Polygon mainnet deployment was attempted.
