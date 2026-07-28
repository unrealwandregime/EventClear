# Staging signer record

Status: **NOT PROVISIONED**

Provider: AWS KMS. Required key spec: `ECC_SECG_P256K1`; usage:
`SIGN_VERIFY`. The key alias, key ARN, verified Ethereum address, creation UTC
time, owning AWS account, application IAM role, RiskPolicy address, and
health-alarm identifier must be recorded after provisioning.

The API accepts only `RISK_SIGNER_BACKEND=kms` for this staging profile. It
recovers every returned signature against `RISK_SIGNER_ADDRESS`. No private key
material may be exported, logged, committed, or copied into a container.
