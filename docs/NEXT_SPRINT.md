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
