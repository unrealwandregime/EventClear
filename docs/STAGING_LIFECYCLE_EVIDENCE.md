# Staging lifecycle evidence

Status: **NOT RUN REMOTELY**

The deployed-contract Anvil integration test covers quote preflight, genuine
EIP-712 quote issuance, approval and bundle-opening simulation/submission
against actual contracts. It is CI evidence, not remote staging evidence.

A remote record must not be completed until it contains the controlled wallet,
analysis and quote identifiers, proof hash, approval/open/settlement/principal
and residual transaction hashes, onchain bundle ID, balances, pool/treasury
reconciliation, and indexer confirmation timestamps. Secret keys must never be
included.
