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
    return encode_call("deposit(uint256,address)", ["uint256", "address"], [assets, receiver])


def withdraw(assets: int, receiver: str, owner: str) -> str:
    return encode_call(
        "withdraw(uint256,address,address)",
        ["uint256", "address", "address"],
        [assets, receiver, owner],
    )
