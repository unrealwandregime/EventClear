# EventClear wallet compatibility

EventClear v1 finances only standard binary CTF positions held directly by the
authenticated EOA that opens the bundle.

| Wallet type | Position reads | Financing execution | Current reason |
| --- | --- | --- | --- |
| EOA | Supported | Supported in local/fork only | SIWE signer, borrower, position wallet and transaction sender must match |
| Polymarket Deposit Wallet | Supported when discoverable | Read-only | Controlling-signer relationship is not independently verified |
| Polymarket Proxy | Supported when discoverable | Read-only | Official proxy authorization path is not integrated and tested |
| Safe | Supported when discoverable | Read-only | Safe owners/threshold/module state is not verified at quote and execution time |
| Unknown contract wallet | Supported by address | Read-only | Control relationship is unknown |

## EOA authorization

The quote API requires an active SIWE session and rejects the request unless:

```text
SIWE address = borrower = position wallet
```

The vault independently requires:

```text
transaction sender = borrower = position wallet = controlling signer
```

Every financing quote commits to
`walletAuthorizationHash = keccak256(PositionWalletAuthorization)`. The
authorization is EIP-712 signed by the EOA and binds the exact bundle, borrower,
position wallet, vault, chain, nonce and expiry. Authorization nonces use a
separate onchain replay map from financing-quote nonces.

The encoded wallet authorization proof passed to `openBundle` contains the
authorization object and its signature. Modified, expired, replayed,
wrong-signer, wrong-chain, wrong-vault and different-bundle proofs revert before
any ERC-1155 transfer.

## Smart-wallet activation requirements

Smart-wallet financing remains disabled until an implementation can verify the
official wallet control relationship at quote time and onchain execution time,
including ownership/threshold changes, replay protection and exact bundle
binding. Adding a generic ECDSA signature or relying on a prior ERC-1155
approval is not sufficient.
