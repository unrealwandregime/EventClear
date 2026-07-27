# Security

EventClear is an experimental unaudited MVP. It is not ready for public deposits or mainnet execution.

Report vulnerabilities privately to the repository security contact. Do not include private keys, production credentials, or user data. Include affected commit, impact, reproduction, and suggested remediation.

Required release checks: secret scan, dependency audit, locked builds, Python tests, TypeScript lint/typecheck/build, Foundry unit/fuzz/invariant tests, contract size, Slither, Docker builds, Playwright lifecycle, and a pinned Polygon fork when an RPC secret is available.

Never store a user key. The development risk key in `.env.example` is public and local-only. Production signing must use an approved remote signer.
