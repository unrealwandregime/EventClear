# Controlled external staging

**OPTIONAL FUTURE FUNDED STAGING / PRODUCTION-LIKE INFRASTRUCTURE.**
This is not the canonical prototype path. The owner has authorized no expense.
For the $0 path use `docs/ZERO_COST_DEPLOYMENT.md` (repository root).


This is a test-asset prototype, never a Polygon-mainnet/public-capital release.
`docs/BUILD_STATUS.md` is the current evidence ledger. The canonical operator
input inventory is `docs/STAGING_CREDENTIAL_CHECKLIST.md`.

## One-time bootstrap

Use authenticated AWS account access, with permission to create IAM/OIDC roles.
No permanent access keys are used for normal deployment. Inspect both templates
and their IAM policies before bootstrap. The CloudFormation execution role can
create the resource types in this stack; it is intentionally separated from the
GitHub role. API permissions without resource-level scoping are explicit in the
bootstrap template. GitHub trust accepts only
`repo:unrealwandregime/EventClear:environment:staging` with the STS audience.
Protect that environment with required reviewers and permitted deployment refs.

```bash
aws cloudformation deploy \
  --template-file infrastructure/aws/bootstrap/template.json \
  --stack-name eventclear-staging-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ExistingOidcProviderArn="$EXISTING_OIDC_PROVIDER_ARN"
aws cloudformation describe-stacks --stack-name eventclear-staging-bootstrap \
  --query 'Stacks[0].Outputs'
```

Set `EXISTING_OIDC_PROVIDER_ARN` to the existing GitHub provider ARN, or an empty
string only after verifying that the account has no provider for
`token.actions.githubusercontent.com`. Bootstrap outputs become non-secret
GitHub environment variables `AWS_ROLE_ARN` and `AWS_STACK_EXECUTION_ROLE_ARN`.
The stack name must start with `eventclear-staging`; keep the bootstrap stack
separate from the billable staging stack.

## Staging operations

Use the protected **Controlled external staging** workflow, an exact reviewed
release SHA, and the actions in this order:

1. `provision-infra`: explicitly check `allow_aws_provision`; set a positive
   operator-chosen `STAGING_BUDGET_USD`. Without `ALLOW_AWS_PROVISION=true`
   provisioning refuses to run. The monthly AWS Budget warns at 80% of the
   supplied amount; it monitors account spending conservatively and is not a
   spending cap. Small single-instance PostgreSQL/cache services are intentional.
2. Confirm the SNS subscription email. Certificate validation/DNS require an
   owned public hosted zone. The zone is discovered by longest matching suffix;
   supply `STAGING_HOSTED_ZONE_ID` only for an ambiguous or intentional override.
3. `preflight`: read stack outputs, validate both HTTPS RPC providers and an
   advancing persistent approved test chain, verify official network information,
   derive isolated actor addresses, verify KMS signing/recovery.
4. `deploy-contracts`: generates a fresh future resolution window, verifies the
   checked-in fixture using the solver, broadcasts the complete mock suite,
   verifies bytecode/roles/risk/constructor state and uploads sanitized evidence.
5. `deploy-services`: set `evidence_run_id` to the successful contract deployment
   run for this exact release SHA. The workflow retrieves and checks the manifest,
   builds immutable full-SHA images, derives runtime secrets/configuration, runs
   migrations, creates missing ECS services/task definitions and checks health.
6. `remote-lifecycle`: use the same contract evidence run. Requires fresh,
   unresolved fixture contracts and testnet gas for all three isolated actors.
   It deposits LP test liquidity, runs the remote quote UI, then executes the
   complete remote financing/settlement/redemption/accounting path. It also
   verifies S3 hashes/immutability, restarts API/indexer, deploys a harmless task
   revision, rolls back and rechecks accounting/persistence. It finishes with
   remote final-state UI and public-readonly isolation checks. A resolved fixture
   cannot be reused; intentionally redeploy fresh test contracts for another run.
7. `monitoring-check`: triggers the dedicated test alarm and returns it to OK.
   API acceptance is not SNS delivery. Save the downloaded monitoring artifact,
   and only after receiving the actual email run
   `node scripts/aws/confirm-monitoring.mjs` with
   `STAGING_ALERT_DELIVERY_REFERENCE` and `STAGING_ALERT_RECEIVED_AT` in UTC.
   The reference must identify the real received notification; do not invent it.
8. `rollback-services`: use a successful service-deployment evidence run containing
   the previous task definitions. Empty/bootstrap revisions cannot be rolled back.
9. `destroy-infra`: require the exact stack name as `destroy_confirmation`.
   This deletes controlled ECS services/registrations and the staging stack;
   ECR test images are removed. S3 evidence, the signing KMS key and the final
   RDS snapshot are retained deliberately and may continue to incur charges.
   The operation records their identities. Review retention needs before using
   AWS's explicit bucket empty/delete, KMS schedule-deletion and snapshot-delete
   operations. No destructive schema downgrade is performed.

Generated manifests/evidence are Actions artifacts, not automatic pushes to
`master`. In a clean checkout of the exact release SHA, set `EVIDENCE_RUN_ID`
and `STAGING_ACTION=promote-evidence` (optionally
`STAGING_EVIDENCE_ACTION=remote-lifecycle` for a successful acceptance run), then run
`node scripts/aws/promote-evidence.mjs` to open a dedicated evidence PR. It checks
the run origin, successful status, Git SHA and manifest hash before promotion.
Never upload raw Foundry cache/broadcast files, environment files or credentials.

## Network and persistence

Only the HTTPS ALB is publicly reachable. Execution/API traffic passes the web
access gateway; unauthenticated ALB routes expose only health/readiness.
The gateway issues a short-lived Secure/HttpOnly/SameSite cookie and keeps its
random access token server-side. SIWE, tester/LP allowlists and admin controls
still apply. Obtain the staging access token securely from the generated runtime
secret in Secrets Manager; do not copy it into frontend build variables.

Fargate uses public subnet addresses for outbound AWS/RPC traffic to avoid a
prototype NAT gateway bill, but task security groups accept no Internet inbound
traffic. API receives traffic from ALB health checks and web only; solver from
API only; indexer/migration accept no inbound traffic. PostgreSQL/Redis use private
subnets and service-specific ingress. RDS uses `verify-full` with the official
AWS bundle; Redis uses authenticated TLS. The S3 bucket is private, encrypted,
versioned and denies insecure transport; content-addressed writes use
`If-None-Match: *` and runtime roles cannot delete artifacts. KMS stores an
unexportable secp256k1 risk key. Test actor keys never enter the ECS runtime.

Each contract manifest gets a separately named PostgreSQL database in the same
private RDS instance. Repeated service releases/restarts retain that database;
a new mock-contract deployment preserves the previous database and starts a new
namespace, so chain events and bundle IDs from different vaults cannot mix.
Indexer start blocks come from verified deployment receipts rather than a
whole-testnet scan. ECS secret references pin the runtime secret version, so
rolling back a task does not accidentally load a newer deployment manifest.

The checksum migration ledger uses a PostgreSQL advisory lock and atomic DDL/
ledger transactions. Repeated deployments do not rerun non-idempotent migrations.
It intentionally refuses to adopt an existing unmanaged schema automatically.
Use a fresh staging database or independently reconcile an existing schema first.

CloudWatch receives ECS/ALB/RDS/Redis telemetry and application embedded metrics
for requests, latency, quote signing, RPC/indexer health and accounting. Dashboard
and alarms are infrastructure definitions; remote activation and actual delivery
must remain unverified until the protected remote checks produce evidence.

## Local checks

```bash
cfn-lint infrastructure/aws/bootstrap/template.json infrastructure/aws/staging/template.json
node --test tests/staging/*.test.mjs
python -m pytest tests/staging/test_staging.py apps/solver/tests apps/api/tests -q
node scripts/aws/test-staging-deployment.mjs
```

The last command creates a disposable local Anvil on a test chain ID with fresh
random keys. It verifies deployment logic without generating remote evidence.
It does not use or require any external wallet credentials.
