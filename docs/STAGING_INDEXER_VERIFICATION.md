# Staging indexer verification

Status: **NOT RUN REMOTELY**

No remote chain, PostgreSQL instance or indexer service exists. Do not populate
this file until an actual run records the starting/final blocks, checkpoint
before and after restart, restart UTC time, reconciliation result,
duplicate-event result and dead-letter count.

Resume after deployment:

```bash
pnpm indexer:backfill -- --from-block "$STAGING_DEPLOYMENT_BLOCK"
pnpm indexer:status
pnpm indexer:reconcile
```
