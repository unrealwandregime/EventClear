from __future__ import annotations

import hashlib
import json
import time
import uuid

from eth_account.messages import encode_typed_data
from eth_abi import encode
from eth_utils import keccak

from eventclear_solver.engine import solve
from eventclear_solver.models import SolverRequest

from .settings import Settings
from .signer import sign_typed_data

BPS = 10_000


def canonical_hash(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return "0x" + hashlib.sha256(encoded).hexdigest()


def bundle_hash(
    legs: list[dict],
    *,
    adapter: str,
    relationship_version: int,
    position_wallet: str,
    borrower: str,
    chain_id: int,
    vault: str,
) -> str:
    try:
        condition_ids = [bytes.fromhex(leg["conditionId"].removeprefix("0x")) for leg in legs]
        if any(len(item) != 32 for item in condition_ids):
            raise ValueError
        token_ids = [int(leg["tokenId"]) for leg in legs]
        outcomes = [1 if leg["outcome"] == "YES" else 0 for leg in legs]
        amounts = [int(leg["amountAtomic"]) for leg in legs]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("LEGS_MUST_USE_BYTES32_CONDITIONS_AND_UINT256_TOKEN_IDS") from exc
    return "0x" + keccak(
        encode(
            [
                "bytes32[]",
                "uint256[]",
                "uint8[]",
                "uint256[]",
                "address",
                "uint32",
                "address",
                "address",
                "uint256",
                "address",
            ],
            [
                condition_ids,
                token_ids,
                outcomes,
                amounts,
                adapter,
                relationship_version,
                position_wallet,
                borrower,
                chain_id,
                vault,
            ],
        )
    ).hex()


def issue_quote(payload: dict, settings: Settings, nonce: int) -> dict:
    request = SolverRequest.model_validate(payload["solverRequest"])
    result = solve(request)
    if not result.isSatisfiable:
        raise ValueError(",".join(result.rejectionReasons))
    floor = int(result.guaranteedFloorAtomic)
    gross_advance = floor * settings.advance_ratio_bps // BPS
    fee = gross_advance * settings.origination_fee_bps // BPS
    net_advance = gross_advance - fee
    expiry = int(time.time()) + settings.quote_lifetime_seconds
    legs = [leg.model_dump(mode="json") for leg in request.legs]
    borrower = payload.get("borrower", payload.get("accountWallet"))
    position_wallet = payload.get("positionWallet", payload.get("accountWallet"))
    if not borrower or not position_wallet:
        raise ValueError("BORROWER_AND_POSITION_WALLET_REQUIRED")
    message = {
        "borrower": borrower,
        "positionWallet": position_wallet,
        "bundleHash": bundle_hash(
            legs,
            adapter=settings.adapter_address,
            relationship_version=request.relationshipVersion,
            position_wallet=position_wallet,
            borrower=borrower,
            chain_id=settings.chain_id,
            vault=settings.vault_address,
        ),
        "relationshipDefinitionHash": request.relationshipDefinitionHash,
        "solverArtifactHash": result.artifactHash,
        "guaranteedFloor": floor,
        "principalAmount": floor,
        "grossAdvance": gross_advance,
        "originationFee": fee,
        "netAdvance": net_advance,
        "expiry": expiry,
        "nonce": nonce,
        "chainId": settings.chain_id,
        "vault": settings.vault_address,
        "fundingPool": settings.funding_pool_address,
        "collateralToken": settings.collateral_token_address,
    }
    domain = {"name": "EventClear", "version": "1", "chainId": settings.chain_id, "verifyingContract": settings.vault_address}
    types = {"FinancingQuote": [
        {"name": "borrower", "type": "address"},
        {"name": "positionWallet", "type": "address"},
        {"name": "bundleHash", "type": "bytes32"},
        {"name": "relationshipDefinitionHash", "type": "bytes32"},
        {"name": "solverArtifactHash", "type": "bytes32"},
        {"name": "guaranteedFloor", "type": "uint256"},
        {"name": "principalAmount", "type": "uint256"},
        {"name": "grossAdvance", "type": "uint256"},
        {"name": "originationFee", "type": "uint256"},
        {"name": "netAdvance", "type": "uint256"},
        {"name": "expiry", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "chainId", "type": "uint256"},
        {"name": "vault", "type": "address"},
        {"name": "fundingPool", "type": "address"},
        {"name": "collateralToken", "type": "address"},
    ]}
    signable = encode_typed_data(domain, types, message)
    signature = sign_typed_data(signable, settings).hex()
    return {
        "id": str(uuid.uuid4()),
        "status": "ISSUED",
        "quote": {key: str(value) if isinstance(value, int) else value for key, value in message.items()},
        "signature": "0x" + signature.removeprefix("0x"),
        "solverResult": result.model_dump(mode="json"),
        "typedData": {"domain": domain, "types": types, "primaryType": "FinancingQuote", "message": message},
        "requestPayload": payload,
    }
