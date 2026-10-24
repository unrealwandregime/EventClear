# Controlled testnet prototype

The canonical prototype path costs $0 and requires no AWS account, paid domain,
KMS, S3, managed AWS service or real funds. `testnet-prototype` is separate from
`staging`: staging keeps its KMS, private solver, S3 and two-RPC requirements.
The public investor site remains `production-readonly`.

The prototype runs the existing web app, API, solver and indexer in one non-root
container. A Python supervisor propagates shutdown and terminates the deployment
when any child exits. Migrations run under the existing PostgreSQL lock/ledger
before processes start. The solver and API bind loopback; a server-side access
barrier exposes a single provider HTTPS port. The provider may sleep the service;
acceptance waits for bounded cold-start readiness rather than defeating sleep
policies with keepalive traffic.

Use five different dedicated test-only identities: deployer, admin, LP, tester,
and risk signer. Never reuse a wallet with personal, trading or production
history. Only the risk key belongs on the host; transaction actor keys belong in
protected workflow secrets. Known Anvil identities and the published repository
example are rejected. Operator provenance is required: software cannot infer a
key's complete history or prove it has zero balances on every chain.

Startup requires `TESTNET_ASSETS_ONLY=true`, `ENABLE_MAINNET_EXECUTION=false`,
`PUBLIC_CAPITAL_ACTIVATED=false`, `PROTOTYPE_MAX_MONTHLY_COST_USD=0`, PostgreSQL,
TLS Redis, HTTPS SIWE/RPC, strong access/admin/session secrets, all actor address
pins/allowlists, a checksum-valid testnet manifest and canonical reviewed fixture.
Only approved Amoy (80002) or Sepolia (11155111) is accepted. Deployment checks
current official metadata and endpoint state. One RPC requires explicit
`RPC_REDUNDANCY_DEGRADED=true`; funded staging still requires two.

The local risk signer must match its pinned address and differ from every other
actor. There is no browser key, smart-wallet bypass, negative-risk execution,
public LP access or mainnet fallback. The execution UI displays **TESTNET
PROTOTYPE · TEST ASSETS ONLY · NO REAL FUNDS**. The actual execution gateway reads
mock testnet positions and resolution from contracts; public research remains
separate.

Proofs use PostgreSQL `solver_artifact_blobs` as an immutable SHA-256-addressed
byte store. Canonical UTF-8 JSON bytes are inserted once; equal writes are
idempotent, conflicting bytes are rejected, and retrieval recomputes the hash.
An update/delete trigger enforces immutability. The existing normalized
`solver_artifacts` table is preserved, as are S3 and KMS adapters for funded
staging. There is no AWS call in the prototype artifact/signing path.

See [zero-cost deployment](ZERO_COST_DEPLOYMENT.md), [actual evidence](TESTNET_PROTOTYPE_EVIDENCE.md)
and [current status](BUILD_STATUS.md). No remote success is implied by code or
local tests. Professional audit/legal approval and production governance remain
future capital-release requirements.

The indexer backfills in bounded block ranges and reconciles against the exact
checkpoint block. A corrupt supported event prevents readiness; unrelated ABI
logs do not become false corruption alerts. RPC-health history retains 24 hours.
The remote runner deliberately suspends the free prototype for an offline-event
catch-up drill, resumes it even on failure, and verifies the recovered event.
Official Sepolia chain ID metadata is read from Geth's current checked-in chain
specification, not a stale name-only website check. Actual RPC/faucet usability
must still be verified before deployment.
