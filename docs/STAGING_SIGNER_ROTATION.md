# Staging signer rotation

1. Pause new originations; leave settlement and redemption available.
2. Create a new AWS KMS `ECC_SECG_P256K1` signing key and restrict its policy to
   the staging API task role.
3. Derive and independently verify its Ethereum address from
   `GetPublicKey`.
4. Update `RiskPolicy` through the controlled staging administrator.
5. Verify the onchain signer, then update the API secret references and deploy
   a new immutable task revision.
6. Issue and recover a zero-capital test quote, verify the signer-health metric,
   and confirm alert recovery.
7. Disable the old key only after all old quotes expire. Schedule deletion only
   after the incident-retention period.
8. Record transaction hashes, KMS key aliases, UTC times, operator approvals,
   and rollback outcome without private material.

Rollback restores the previous RiskPolicy signer and task revision while the
old KMS key remains enabled.
