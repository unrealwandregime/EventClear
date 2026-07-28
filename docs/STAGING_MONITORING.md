# Staging monitoring

Prometheus configuration and alert rules live in
`infrastructure/monitoring`. The checked-in Grafana dashboard covers API rate
and latency, quote rejection codes, indexer lag, pool liquidity, outstanding
cost basis, utilization, LP yield, losses and treasury fees.

Before declaring staging operational, connect Alertmanager/error reporting and
centralized JSON logs, then exercise alerts for API/solver/database/Redis/RPC
failure, fallback activation, indexer lag/reconciliation, signer failure,
rejection spikes, reserve/utilization, settlement/shortfall, policy/role/pause
changes, unexpected balances and bytecode mismatch. Record a screenshot or
alert-delivery identifier from the remote system.

The local files are configuration evidence only; monitoring is not currently
active on an external host.
