# Staging incident response

1. Pause new originations through the risk-policy role; do not pause
   settlement or redemption.
2. Preserve API, indexer, RPC and signer logs plus the last reconciled block.
3. Disable the staging ingress if authentication, signer or administrator
   material may be exposed.
4. Reconcile contract bytecode, roles, balances, bundle state, pool book assets
   and treasury records from two RPC endpoints.
5. Rotate affected staging secrets and redeploy only from the recorded commit.
6. Restore the indexer from its last canonical checkpoint and run reconciliation
   before reopening.
7. Document scope, timestamps, transaction hashes, root cause and corrective
   actions. Never reuse staging keys for production.

Shortfall and settlement incidents must preserve claimant redemption paths.
Mainnet activation remains a separate, prohibited action.
