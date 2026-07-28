# Test matrix

| Boundary | Evidence |
| --- | --- |
| Solver exactness and tamper rejection | Python unit/property tests |
| API identity, replay and pre-sign checks | API tests |
| Contract lifecycle and invariants | Foundry unit/fuzz/invariant tests |
| Real API-to-contract calls | Anvil contract-integration tests |
| Polygon dependencies | Pinned genuine fork tests |
| ABI compatibility | Compiler-backed API ABI checker |
| Indexer reorg/idempotency/reconciliation | Node indexer tests |
| Wallet lifecycle and failure paths | Playwright tests |
| Supply chain | Gitleaks, dependency, license and Slither jobs |
| Images/reproducibility | Docker and Linux CI jobs |

Remote AWS evidence is absent until credentials are supplied.
