# Economic invariants

- Guaranteed payout is the minimum exact payout over every reviewed terminal
  world.
- Net advance equals gross advance cost basis minus quoted origination fee.
- Pending quoted fees are not assets and are realized only from settlement
  return.
- Pool book assets reconcile liquid assets, outstanding cost basis, realized LP
  yield and realized losses as specified in `docs/POOL_ACCOUNTING.md`.
- Principal receives settlement proceeds before residual.
- Break-even and shortfall settlements pay no protocol fee.
- Per-bundle, wallet, market, relationship and global exposure never exceed
  RiskPolicy limits; pool reserve and utilization gates apply before funding.
