from __future__ import annotations

from eth_abi import encode
from eth_utils import keccak


def encode_call(signature: str, types: list[str], values: list[object]) -> str:
    selector = keccak(text=signature)[:4]
    return "0x" + (selector + encode(types, values)).hex()


def redeem_claim(claim_type: str, bundle_id: int, amount: int) -> str:
    if claim_type == "PRINCIPAL":
        signature = "redeemPrincipal(uint256,uint256)"
    elif claim_type == "RESIDUAL":
        signature = "redeemResidual(uint256,uint256)"
    else:
        raise ValueError("UNSUPPORTED_CLAIM_TYPE")
    return encode_call(signature, ["uint256", "uint256"], [bundle_id, amount])


def deposit(assets: int, receiver: str) -> str:
    return encode_call(
        "deposit(uint256,address)", ["uint256", "address"], [assets, receiver]
    )


def withdraw(assets: int, receiver: str, owner: str) -> str:
    return encode_call(
        "withdraw(uint256,address,address)",
        ["uint256", "address", "address"],
        [assets, receiver, owner],
    )


QUOTE_TYPE = (
    "(address,address,bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,"
    "uint256,uint256,uint256,uint256,uint256,uint256,uint256,address,address,address)"
)
WALLET_AUTHORIZATION_TYPE = (
    "(address,address,address,bytes32,address,uint256,uint256,uint256)"
)


def _bytes32(value: str) -> bytes:
    raw = bytes.fromhex(value.removeprefix("0x"))
    if len(raw) != 32:
        raise ValueError("INVALID_BYTES32")
    return raw


def set_approval_for_all(operator: str, approved: bool = True) -> str:
    return encode_call(
        "setApprovalForAll(address,bool)",
        ["address", "bool"],
        [operator, approved],
    )


def settle_bundle(bundle_id: int) -> str:
    return encode_call("settle(uint256)", ["uint256"], [bundle_id])


def open_bundle(
    quote: dict,
    quote_signature: str,
    wallet_authorization: dict,
    wallet_authorization_signature: str,
    legs: list[dict],
    relationship_version: int,
) -> str:
    quote_tuple = (
        quote["borrower"],
        quote["positionWallet"],
        _bytes32(quote["bundleHash"]),
        _bytes32(quote["walletAuthorizationHash"]),
        _bytes32(quote["relationshipDefinitionHash"]),
        _bytes32(quote["solverArtifactHash"]),
        int(quote["earliestResolutionTimestamp"]),
        int(quote["latestResolutionTimestamp"]),
        int(quote["guaranteedFloor"]),
        int(quote["principalAmount"]),
        int(quote["grossAdvance"]),
        int(quote["originationFee"]),
        int(quote["netAdvance"]),
        int(quote["expiry"]),
        int(quote["nonce"]),
        int(quote["chainId"]),
        quote["vault"],
        quote["fundingPool"],
        quote["collateralToken"],
    )
    authorization_tuple = (
        wallet_authorization["controllingSigner"],
        wallet_authorization["borrower"],
        wallet_authorization["positionWallet"],
        _bytes32(wallet_authorization["bundleHash"]),
        wallet_authorization["vault"],
        int(wallet_authorization["chainId"]),
        int(wallet_authorization["nonce"]),
        int(wallet_authorization["expiry"]),
    )
    authorization_proof = encode(
        [WALLET_AUTHORIZATION_TYPE, "bytes"],
        [
            authorization_tuple,
            bytes.fromhex(wallet_authorization_signature.removeprefix("0x")),
        ],
    )
    conditions = [_bytes32(leg["conditionId"]) for leg in legs]
    token_ids = [int(leg["tokenId"]) for leg in legs]
    outcomes = [1 if leg["outcome"] == "YES" else 0 for leg in legs]
    amounts = [int(leg["amountAtomic"]) for leg in legs]
    return encode_call(
        f"openBundle({QUOTE_TYPE},bytes,bytes,bytes32[],uint256[],uint8[],uint256[],uint32)",
        [
            QUOTE_TYPE,
            "bytes",
            "bytes",
            "bytes32[]",
            "uint256[]",
            "uint8[]",
            "uint256[]",
            "uint32",
        ],
        [
            quote_tuple,
            bytes.fromhex(quote_signature.removeprefix("0x")),
            authorization_proof,
            conditions,
            token_ids,
            outcomes,
            amounts,
            relationship_version,
        ],
    )
