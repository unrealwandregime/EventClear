# External staging credential checklist

External staging is blocked until all items below exist. Values are GitHub
Actions environment secrets in the protected `staging` environment; never
commit them.

- `AWS_ROLE_ARN`: GitHub OIDC role allowed to deploy the staging stack and push
  images.
- `AWS_REGION`: one approved AWS region.
- `AWS_ACCOUNT_ID`: account that owns the isolated staging resources.
- `STAGING_STACK_NAME`: CloudFormation stack name.
- `STAGING_RPC_PRIMARY` and `STAGING_RPC_FALLBACK`: authenticated HTTPS
  endpoints for one persistent non-137 chain.
- `STAGING_CHAIN_ID`: stable chain ID, explicitly not `137`.
- `STAGING_DEPLOYER_PRIVATE_KEY`: encrypted, staging-only deployment key used
  only for the explicitly approved contract action. A KMS-backed deployer may
  replace this after the Foundry signing path supports it.
- `STAGING_ADMIN_ADDRESS`, `STAGING_LP_ADDRESS`, `STAGING_TEST_EOA`: distinct
  controlled addresses.
- `RISK_SIGNER_KMS_KEY_ID`, `RISK_SIGNER_ADDRESS`: AWS KMS secp256k1 signing key
  and its verified Ethereum address.
- `STAGING_RELATIONSHIP_HASH`, `STAGING_RULES_HASH`,
  `STAGING_EARLIEST_RESOLUTION`, `STAGING_LATEST_RESOLUTION`: reviewed test-only
  relationship metadata.
- `STAGING_ALERT_TOPIC_ARN`: SNS topic with a confirmed real notification
  subscription.
- `STAGING_ECS_NETWORK_CONFIGURATION`: AWS CLI Fargate network JSON for the
  private migration task.
- `STAGING_API_HEALTH_URL` and `STAGING_WEB_URL`: access-controlled HTTPS
  endpoints used by post-deploy health checks.
- `STAGING_HOSTED_ZONE_ID` and `STAGING_DOMAIN`: Route 53 zone and dedicated
  access-controlled staging hostname.

Minimum GitHub action:

```bash
gh api --method PUT repos/unrealwandregime/EventClear/environments/staging
gh secret set AWS_ROLE_ARN --env staging --repo unrealwandregime/EventClear
gh secret set AWS_REGION --env staging --repo unrealwandregime/EventClear
gh secret set AWS_ACCOUNT_ID --env staging --repo unrealwandregime/EventClear
gh secret set STAGING_STACK_NAME --env staging --repo unrealwandregime/EventClear
```

Set the remaining values through the same hidden prompt form. Configure the
`staging` environment with required reviewers before any deploy action.
