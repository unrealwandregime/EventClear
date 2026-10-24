# Zero-cost testnet prototype — current continuation

Canonical state: `BUILD_STATUS.md`. The required next path costs $0 and needs no
AWS account. Finish validating the combined image and prototype tests, then
verify genuinely free provider terms and bind owner-controlled accounts/secrets
using `ZERO_COST_DEPLOYMENT.md`. Deploy the mock suite with faucet gas, run the
remote lifecycle/UI/restart/catch-up/reconciliation/rollback checks and record
actual evidence in `TESTNET_PROTOTYPE_EVIDENCE.md`.

Do not claim operational status before external evidence. Preserve the public
read-only site. No paid plan, mainnet, real funds or public LP access is allowed.

## Historical funded AWS continuation (optional future path)

# External working prototype — current continuation

Canonical state: `BUILD_STATUS.md`. Historical milestones in other documents
must not be interpreted as current remote evidence.

Implemented in the final prototype branch:

- CloudFormation OIDC bootstrap and test-only AWS infrastructure.
- Derived AWS/KMS/actor/relationship configuration.
- First-deployment ECS task/service creation, migration ledger and rollback.
- Controlled staging gateway and test-only onchain market fixture.
- Remote backend/UI acceptance, restart, reconciliation and evidence automation.
- CloudWatch/SNS definitions and explicit delivery confirmation.

Still requires execution and evidence:

- Supply the external inputs in `STAGING_CREDENTIAL_CHECKLIST.md`.
- Provision the stack with an explicit operator budget/provisioning switch.
- Deploy fresh non-mainnet test contracts and protected HTTPS services.
- Run the remote lifecycle/UI/persistence/rollback checks.
- Trigger and confirm real SNS delivery.
- Promote sanitized evidence through a PR, then revalidate the public release.
- Read the actual CI result; local checks are not GitHub CI evidence.

Independent audit, legal approval, production custody/multisigs, mainnet
contracts and public capital remain incomplete later-release requirements.
They do not block a test-asset prototype. No mainnet activation is authorized.
