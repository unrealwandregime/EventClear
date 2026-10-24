# Security

Current prototype direction: **zero-cost `testnet-prototype`**, separate from
the public investor read-only site, future funded AWS staging and future
production. See `docs/TESTNET_PROTOTYPE.md` and `docs/ZERO_COST_DEPLOYMENT.md`.
Prototype risk signing may use a dedicated isolated local key; funded staging
and controlled production keep KMS requirements. PostgreSQL proof blobs replace
S3 only for this explicit prototype mode. No real funds/public LP/mainnet.
External prototype remains unverified until actual acceptance evidence exists.


EventClear is an experimental unaudited MVP. It is not ready for public deposits or mainnet execution.

Report vulnerabilities privately to the repository security contact. Do not include private keys, production credentials, or user data. Include affected commit, impact, reproduction, and suggested remediation.

Required release checks: secret scan, dependency audit, locked builds, Python tests, TypeScript lint/typecheck/build, Foundry unit/fuzz/invariant tests, contract size, Slither, Docker builds, Playwright lifecycle, and a pinned Polygon fork when an RPC secret is available.

Never store a user key. The development risk key in `.env.example` is public and local-only. Production signing must use an approved remote signer.

Execution-enabled staging also rejects the repository development signer,
Polygon chain ID 137, memory storage, absent PostgreSQL/Redis/RPC fallback,
missing tester/admin/LP allowlists, and missing private artifact storage. The
selected staging signer is a dedicated AWS KMS secp256k1 key. Solver artifacts
are content-addressed, written immutably to a private encrypted/versioned
bucket, and hash-verified on retrieval.

## Controlled external staging boundary

Staging uses only dedicated testnet keys and mock collateral on an explicit
persistent non-mainnet chain. GitHub OIDC is restricted to the protected staging
environment. KMS risk keys are non-exportable; actor keys never enter ECS or
frontend bundles. Public production-readonly routes remain isolated.
Staging access cookies supplement SIWE and wallet allowlists. See
`docs/STAGING_CREDENTIAL_CHECKLIST.md` for credential provenance and
`infrastructure/aws/README.md` for network, retention and rollback controls.
No independent audit, legal approval or public-capital activation is implied.
