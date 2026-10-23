# Reproducible AWS staging setup

The CloudFormation implementation supersedes the historical manual CLI-only
setup. Use [the operator runbook](../infrastructure/aws/README.md) and
[the canonical input inventory](STAGING_CREDENTIAL_CHECKLIST.md).

Templates:

- `infrastructure/aws/bootstrap/template.json`: GitHub OIDC provider (or an
  existing provider), exact repository/environment trust, deploy role and
  separate CloudFormation execution role.
- `infrastructure/aws/staging/template.json`: network/security groups, HTTPS
  ALB/certificate/DNS, ECS/ECR, private RDS/Redis, private versioned S3,
  secp256k1 KMS, scoped task roles, generated secrets, logs/alarms/dashboard,
  SNS subscription and an explicit operator-supplied budget.

`.github/workflows/staging-deploy.yml` separates provisioning, contract
broadcast, service bootstrap/update, remote acceptance, monitoring, rollback
and destruction. It derives infrastructure values from AWS. Contract evidence
is retained as immutable Actions artifacts and promoted through a separate PR.
Normal deployments use OIDC, not long-lived AWS keys.

Provisioning is blocked unless `ALLOW_AWS_PROVISION=true` and an explicit
`STAGING_BUDGET_USD` is supplied. All contracts and actors are test-only, with
mainnet/public-capital activation prohibited. No infrastructure or deployment
is implied by checked-in templates. See `BUILD_STATUS.md` for actual evidence.
