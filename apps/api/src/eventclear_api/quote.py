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


def bundle_hash(legs: list[dict]) -> str:
    try:
        condition_ids = [bytes.fromhex(leg["conditionId"].removeprefix("0x")) for leg in legs]
        if any(len(item) != 32 for item in condition_ids):
            raise ValueError
        token_ids = [int(leg["tokenId"]) for leg in legs]
        amounts = [int(leg["amountAtomic"]) for leg in legs]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("LEGS_MUST_USE_BYTES32_CONDITIONS_AND_UINT256_TOKEN_IDS") from exc
    return "0x" + keccak(encode(["bytes32[]", "uint256[]", "uint256[]"], [condition_ids, token_ids, amounts])).hex()


def issue_quote(payload: dict, settings: Settings, nonce: int) -> dict:
    request = SolverRequest.model_validate(payload["solverRequest"])
    result = solve(request)
    if not result.isSatisfiable:
        raise ValueError(",".join(result.rejectionReasons))
    floor = int(result.guaranteedFloorAtomic)
    fee = floor * 50 // BPS
    reserve = floor * 100 // BPS
    advance = floor * 9_500 // BPS - fee - reserve
    expiry = int(time.time()) + settings.quote_lifetime_seconds
    legs = [leg.model_dump(mode="json") for leg in request.legs]
    message = {
        "accountWallet": payload["accountWallet"],
        "bundleHash": bundle_hash(legs),
        "relationshipDefinitionHash": request.relationshipDefinitionHash,
        "solverProofHash": result.proofArtifactHash,
        "guaranteedFloor": floor,
        "principalAmount": floor,
        "advanceAmount": advance,
        "originationFee": fee,
        "expiry": expiry,
        "nonce": nonce,
        "chainId": settings.chain_id,
        "vault": settings.vault_address,
    }
    domain = {"name": "EventClear", "version": "1", "chainId": settings.chain_id, "verifyingContract": settings.vault_address}
    types = {"FinancingQuote": [
        {"name": "accountWallet", "type": "address"},
        {"name": "bundleHash", "type": "bytes32"},
        {"name": "relationshipDefinitionHash", "type": "bytes32"},
        {"name": "solverProofHash", "type": "bytes32"},
        {"name": "guaranteedFloor", "type": "uint256"},
        {"name": "principalAmount", "type": "uint256"},
        {"name": "advanceAmount", "type": "uint256"},
        {"name": "originationFee", "type": "uint256"},
        {"name": "expiry", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "chainId", "type": "uint256"},
        {"name": "vault", "type": "address"},
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
    }
