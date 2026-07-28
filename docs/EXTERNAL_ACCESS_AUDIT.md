# External access audit

Verified at `2026-07-28T15:24:21Z` from the release-operations
environment. Secret values were not read or recorded.

| Required capability | Detected provider | Authentication status | Non-secret resource identifier | Codex can modify | Exact blocker |
| --- | --- | --- | --- | --- | --- |
| Source control and CI | GitHub | available | `unrealwandregime/EventClear` | yes | None. The authenticated account has repository and workflow access. |
| Public read-only hosting | OpenAI Sites | available | `appgprj_6a6701d60c648191839b4d979ef76d49` | yes | None. Project is active and public. |
| Container runtime / managed application platform | None detected | unavailable | None | no | No Railway, Render, Fly.io, AWS, Google Cloud, Azure, Kubernetes, Vercel or local Docker authentication/runtime is present. |
| Managed PostgreSQL | None detected | unavailable | None | no | No provider resource, connection-secret reference or authenticated provider CLI is available. |
| Managed Redis | None detected | unavailable | None | no | No provider resource, connection-secret reference or authenticated provider CLI is available. |
| Object storage | None detected | unavailable | None | no | The Sites project has no R2 binding and no S3, MinIO or other bucket credential is available. |
| Secret manager / KMS | None detected | unavailable | None | no | No KMS provider, key identifier or authenticated cloud account is available. |
| Persistent staging chain | None detected | unavailable | None | no | No remote private-chain resource or approved public-testnet deployment credential is available. |
| Polygon fork RPC | GitHub Actions secret | available for CI fork validation only | `POLYGON_RPC_URL` | yes, as a repository secret | This endpoint is not authorization to deploy EventClear contracts and is not a persistent staging-chain resource. |
| DNS provider | OpenAI Sites-managed hostname only | unavailable for staging | `eventclear-protocol.thecryptotom.chatgpt.site` | public Site only | No DNS-zone credential exists for an execution-enabled staging hostname. |
| TLS | OpenAI Sites-managed TLS only | available for public Site | Public Sites hostname | public Site only | No staging service or hostname exists to terminate TLS. |
| Error reporting | None detected | unavailable | None | no | No Sentry or equivalent organization/project authentication is present. |
| Metrics and alerting | None detected | unavailable | None | no | No hosted Grafana, Datadog, CloudWatch or equivalent destination and no notification channel are available. |
| Log aggregation | None detected | unavailable | None | no | No remote log destination or authenticated application platform exists. |
| Staging notification destination | None detected | requires user action | None | no | A real alert receiver must be selected and authorized before delivery can be tested. |

## Current public Sites state

- Access mode: `public`
- Active URL: `https://eventclear-protocol.thecryptotom.chatgpt.site`
- Latest deployed version after refresh: `11`
- Version 11 source commit: `595be4926a39667340311395b3a943d43bd8c05e`
- Hosted environment-variable revision: `0`
- Hosted runtime variables: none

## First external credential boundary

The first operation that cannot be performed is creation of the managed
staging project and its PostgreSQL, Redis, object-storage, secret and service
resources. AWS is the selected preparation target because no incumbent
execution platform is connected and the complete control set requires
ECS/Fargate, RDS, ElastiCache, encrypted/versioned S3, KMS, Secrets Manager and
CloudWatch. Railway was evaluated but its native bucket and database
operational guarantees do not satisfy this release boundary.

External staging remains **incomplete**. No staging URL, contract address,
transaction hash, alert identifier, backup, restore or rollback result may be
recorded until the provider resources exist and are independently reachable.

## Minimum user credential checklist

Provide all of the following through provider/GitHub secret storage, never in
chat or source control:

1. An authenticated AWS account and GitHub OIDC role with permission to create
   the scoped staging resources.
2. A dedicated Route 53 staging hostname and ACM certificate.
3. A dedicated AWS KMS staging quote-signing key.
4. Primary and fallback authenticated RPC endpoints for a persistent,
   non-mainnet staging chain.
5. A private S3-compatible object-storage bucket and credential references.
6. An error-reporting DSN and a metrics/alerting destination with one real
   notification receiver.
7. Strong staging admin credentials plus tester, administrator and LP
   allowlists.

The provider-specific resume procedure is maintained with the staging
infrastructure artifacts. The single checklist is
`docs/STAGING_CREDENTIAL_CHECKLIST.md`; setup commands are in
`docs/AWS_STAGING_SETUP.md`. After credentials are installed, deployment must
resume with the access preflight; it must not skip directly to contract or
lifecycle evidence.
