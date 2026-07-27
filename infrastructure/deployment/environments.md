# Deployment environments

| Environment | Mode | Writes | Purpose |
|---|---|---:|---|
| development | local | local chain | Daily development |
| test | local | ephemeral | CI integration and E2E |
| staging | polygon-fork | fork only | Release candidate |
| production-readonly | polygon-mainnet | no | Live discovery and monitoring |
| production-mainnet | polygon-mainnet | yes, gated | Multisig-approved pilot |

Frontend: Vercel or Sites. API, solver, and indexer: separate containers on Railway, Fly.io, ECS, or Kubernetes. PostgreSQL and Redis must be managed services with backups and private networking.

Production contract deployment is a reviewed Foundry broadcast prepared offline, simulated on a pinned fork, and executed by hardware-wallet/multisig signers. Constructor arguments, bytecode, roles, and official Polymarket manifest must be independently compared before source verification.
