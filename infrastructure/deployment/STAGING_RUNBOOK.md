# Controlled staging runbook

Staging is an execution-capable local or Polygon-fork environment. It is
separate from the public `production-readonly` website and must never hold
public capital.

Required services:

- frontend;
- FastAPI protocol API;
- deterministic solver;
- canonical Viem indexer;
- PostgreSQL;
- Redis;
- S3-compatible artifact storage;
- OpenTelemetry-compatible monitoring and centralized JSON logs;
- development or KMS-backed quote signer;
- multisig-ready administrative addresses;
- an explicit small `LP_ALLOWLIST`.

## Bring-up

```bash
cp infrastructure/deployment/staging.env.example infrastructure/deployment/staging.env
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file infrastructure/deployment/staging.env build
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file infrastructure/deployment/staging.env up --detach
EVENTCLEAR_MODE=staging pnpm contracts:verify-manifest
pnpm indexer:status
pnpm indexer:reconcile
pnpm test:e2e
```

Before enabling staging writes, replace every placeholder secret, deploy only
to Anvil or an approved fork, synchronize `config/contracts/local.json`, verify
the quote signer and administrative addresses, and test the allowlist with a
single controlled account.

Deploy test-only contracts with a dedicated encrypted deployer:

```bash
cd packages/contracts
forge script script/DeployStaging.s.sol:DeployStaging \
  --rpc-url "$STAGING_RPC_URL" --broadcast -vvv
cd ../..
pnpm deployment:record-staging
```

The deployment script has no default private key. The recorder rejects missing
bytecode and writes `config/contracts/staging.json` plus the deployment record.
Staging startup rejects the default development signer, weak administrator
token, non-HTTPS SIWE URI, missing LP allowlist, and fewer than two RPC URLs.

## Public read-only environment

The public website uses `EVENTCLEAR_MODE=production-readonly`,
`CHAIN_ID=137`, and `ENABLE_MAINNET_EXECUTION=false`. No signer key is exposed
to the web runtime and no EventClear mainnet broadcast is part of this runbook.

## Promotion blockers

Promotion to a capital-enabled Polygon environment requires an independent
security review, legal approval, production multisigs, KMS/HSM signing,
verified contracts, monitoring/incident drills and an explicitly approved
controlled-capital activation. These are external approvals, not CI flags.
