from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from eth_utils import keccak

from eventclear_solver.engine import solve
from eventclear_solver.models import SolverRequest


BPS = 10_000
ALLOWED_SCHEMA = "CRYPTO_THRESHOLD_V1"


class QuotePreflightError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _reject(condition: bool, code: str) -> None:
    if condition:
        raise QuotePreflightError(code)


def relationship_rejection_code(relationship: dict | None) -> str:
    if relationship is None:
        return "RELATIONSHIP_NOT_FOUND"
    status = relationship.get("status")
    if status == "SUSPENDED":
        return "RELATIONSHIP_SUSPENDED"
    if status == "RETIRED":
        return "RELATIONSHIP_RETIRED"
    return "RELATIONSHIP_NOT_ACTIVE"


def _validate_relationship(
    relationship: dict, request: SolverRequest, now: int
) -> None:
    _reject(
        relationship.get("status") != "APPROVED",
        relationship_rejection_code(relationship),
    )
    _reject(
        relationship.get("relationshipType") != ALLOWED_SCHEMA,
        "UNSUPPORTED_RELATIONSHIP_SCHEMA",
    )
    _reject(
        relationship.get("canonicalDefinitionHash")
        != request.relationshipDefinitionHash,
        "RELATIONSHIP_HASH_MISMATCH",
    )
    _reject(
        int(relationship.get("version", 0)) != request.relationshipVersion,
        "RELATIONSHIP_VERSION_MISMATCH",
    )
    rule_hash = relationship.get("resolutionRulesHash")
    _reject(
        not isinstance(rule_hash, str)
        or len(rule_hash) != 66
        or rule_hash == "0x" + "00" * 32,
        "RELATIONSHIP_RULE_HASH_INCOMPLETE",
    )
    earliest = int(relationship.get("earliestResolutionTimestamp", 0))
    latest = int(relationship.get("latestResolutionTimestamp", 0))
    _reject(
        earliest <= 0 or latest < earliest, "RELATIONSHIP_RESOLUTION_WINDOW_INVALID"
    )
    _reject(latest <= now, "MARKET_RESOLUTION_WINDOW_PASSED")


def _validate_solver(request: SolverRequest) -> tuple[Any, int]:
    first = solve(request)
    second = solve(request, timestamp=first.generatedAt)
    _reject(first != second, "SOLVER_ARTIFACT_NOT_REPRODUCIBLE")
    _reject(not first.approvedDefinitionFound, "SOLVER_DEFINITION_NOT_APPROVED")
    _reject(not first.satisfiable, "SOLVER_UNSATISFIABLE")
    _reject(not first.financingEligible, "FINANCING_NOT_ELIGIBLE")
    floor = int(first.guaranteedFloorAtomic)
    _reject(floor <= 0, "GUARANTEED_FLOOR_ZERO")
    _reject(
        first.validWorldCount != len(request.payoutModel.validWorlds)
        or len(first.terminalWorlds) != first.validWorldCount,
        "TERMINAL_WORLDS_INCOMPLETE",
    )
    _reject(not first.minimumWitnessWorlds, "MINIMUM_WITNESS_MISSING")
    _reject(not first.maximumWitnessWorlds, "MAXIMUM_WITNESS_MISSING")
    return first, floor


def _reviewed_market_map(relationship: dict) -> dict[str, dict]:
    reviewed = relationship.get("reviewedMarkets")
    _reject(
        not isinstance(reviewed, list) or not reviewed,
        "REVIEWED_MARKET_METADATA_MISSING",
    )
    result = {
        str(item.get("conditionId", "")).lower(): item
        for item in reviewed
        if isinstance(item, dict)
    }
    _reject(len(result) != len(reviewed), "REVIEWED_MARKET_METADATA_INVALID")
    return result


def _validate_legs(request: SolverRequest, relationship: dict) -> dict[str, dict]:
    reviewed = _reviewed_market_map(relationship)
    seen_tokens: set[str] = set()
    seen_conditions: set[str] = set()
    for leg in request.legs:
        _reject(
            leg.tokenId in seen_tokens or leg.conditionId.lower() in seen_conditions,
            "DUPLICATE_LEG",
        )
        seen_tokens.add(leg.tokenId)
        seen_conditions.add(leg.conditionId.lower())
        market = reviewed.get(leg.conditionId.lower())
        _reject(market is None, "MARKET_NOT_REVIEWED")
        _reject(not market.get("standardBinary"), "UNSUPPORTED_NON_STANDARD_POSITION")
        _reject(bool(market.get("negativeRisk")), "UNSUPPORTED_NEGATIVE_RISK_POSITION")
        _reject(bool(market.get("combo")), "UNSUPPORTED_COMBO_POSITION")
        _reject(bool(market.get("resolved")), "MARKET_ALREADY_RESOLVED")
        _reject(
            not market.get("active") or market.get("closed"),
            "MARKET_CLOSED_OR_UNSUPPORTED",
        )
        _reject(
            str(market.get("tokenIds", {}).get(leg.outcome)) != leg.tokenId,
            "TOKEN_MARKET_SEMANTICS_MISMATCH",
        )
        _reject(
            market.get("ruleDocumentHash") != relationship.get("resolutionRulesHash"),
            "RULE_DOCUMENT_HASH_MISMATCH",
        )
    return reviewed


def _validate_pool_and_risk(
    *,
    payload: dict,
    relationship: dict,
    settings: Any,
    pool: dict,
    risk: dict,
    floor: int,
    now: int,
) -> None:
    gross = floor * settings.advance_ratio_bps // BPS
    quoted_fee = gross * settings.origination_fee_bps // BPS
    net = gross - quoted_fee
    _reject(
        not isinstance(settings.funding_pool_address, str)
        or settings.funding_pool_address.lower() == "0x" + "0" * 40,
        "POOL_ADDRESS_NOT_CONFIGURED",
    )
    _reject(not pool.get("bytecodeExists"), "POOL_CONTRACT_NOT_DEPLOYED")
    _reject(gross > int(pool["perBundleCap"]), "POOL_PER_BUNDLE_CAP")
    total_assets = int(pool["totalAssets"])
    liquid = int(pool["liquidAssets"])
    reserve = total_assets * int(pool["minimumReserveBps"]) // BPS
    _reject(liquid < net or liquid - net < reserve, "POOL_LIQUIDITY_INSUFFICIENT")
    outstanding = int(pool["outstandingAdvanceCostBasis"])
    _reject(
        total_assets == 0
        or (outstanding + gross) * BPS > total_assets * int(pool["utilizationCapBps"]),
        "POOL_UTILIZATION_LIMIT",
    )
    _reject(not risk.get("schemaAllowed"), "RELATIONSHIP_SCHEMA_NOT_ALLOWLISTED")
    _reject(bool(risk.get("originationsPaused")), "ORIGINATIONS_PAUSED")
    _reject(not risk.get("adapterAllowed"), "ADAPTER_NOT_ALLOWLISTED")
    _reject(not risk.get("collateralAllowed"), "COLLATERAL_NOT_ALLOWLISTED")
    _reject(gross > int(risk["maximumGrossAdvance"]), "MAXIMUM_GROSS_ADVANCE_EXCEEDED")
    _reject(
        gross * BPS > floor * int(risk["maximumAdvanceRatioBps"]),
        "MAXIMUM_ADVANCE_RATIO_EXCEEDED",
    )
    latest = int(relationship["latestResolutionTimestamp"])
    _reject(
        latest - now > int(risk["maximumBundleDuration"]), "BUNDLE_DURATION_EXCEEDED"
    )
    wallet = str(payload["positionWallet"]).lower()
    relationship_hash = relationship["canonicalDefinitionHash"].lower()
    _reject(
        int(risk["walletExposure"].get(wallet, 0)) + gross
        > int(risk["perWalletExposureCap"]),
        "WALLET_EXPOSURE_LIMIT",
    )
    _reject(
        int(risk["relationshipExposure"].get(relationship_hash, 0)) + gross
        > int(risk["perRelationshipExposureCap"]),
        "RELATIONSHIP_EXPOSURE_LIMIT",
    )
    for leg in payload["solverRequest"]["legs"]:
        condition_id = str(leg["conditionId"]).lower()
        _reject(
            int(risk["marketExposure"].get(condition_id, 0)) + gross
            > int(risk["perMarketExposureCap"]),
            "MARKET_EXPOSURE_LIMIT",
        )
    _reject(
        int(risk["globalExposure"]) + gross > int(risk["globalExposureCap"]),
        "GLOBAL_EXPOSURE_LIMIT",
    )


async def _live_pool_and_risk(
    settings: Any, gateway: Any, payload: dict, relationship: dict
) -> tuple[dict, dict]:
    pool_code, risk_code, registry_code = await asyncio.gather(
        gateway.contract_code(settings.funding_pool_address),
        gateway.contract_code(settings.risk_policy_address),
        gateway.contract_code(settings.relationship_registry_address),
    )
    pool_names = (
        "liquidAssets",
        "totalAssets",
        "outstandingAdvanceCostBasis",
        "perBundleCap",
        "utilizationCapBps",
        "minimumReserveBps",
    )
    pool_values = await asyncio.gather(
        *(
            gateway.contract_call(settings.funding_pool_address, f"{name}()")
            for name in pool_names
        )
    )
    pool = dict(zip(pool_names, pool_values, strict=True))
    pool["bytecodeExists"] = pool_code != "0x"
    _reject(risk_code == "0x", "RISK_POLICY_NOT_DEPLOYED")
    _reject(registry_code == "0x", "RELATIONSHIP_REGISTRY_NOT_DEPLOYED")
    relationship_hash_bytes = bytes.fromhex(
        relationship["canonicalDefinitionHash"].removeprefix("0x")
    )
    active, onchain_version, resolution_window = await asyncio.gather(
        gateway.contract_call(
            settings.relationship_registry_address,
            "isActive(bytes32)",
            ["bytes32"],
            [relationship_hash_bytes],
        ),
        gateway.contract_call(
            settings.relationship_registry_address,
            "versionOf(bytes32)",
            ["bytes32"],
            [relationship_hash_bytes],
        ),
        gateway.contract_call_words(
            settings.relationship_registry_address,
            "resolutionWindowOf(bytes32)",
            ["bytes32"],
            [relationship_hash_bytes],
        ),
    )
    _reject(not active, "RELATIONSHIP_NOT_ACTIVE_ONCHAIN")
    _reject(
        onchain_version != int(relationship["version"]), "RELATIONSHIP_VERSION_CONFLICT"
    )
    _reject(
        resolution_window
        != [
            int(relationship["earliestResolutionTimestamp"]),
            int(relationship["latestResolutionTimestamp"]),
        ],
        "RELATIONSHIP_RESOLUTION_WINDOW_CONFLICT",
    )
    risk_names = (
        "maximumBundleDuration",
        "maximumAdvanceRatioBps",
        "maximumGrossAdvance",
        "perWalletExposureCap",
        "perMarketExposureCap",
        "perRelationshipExposureCap",
        "globalExposureCap",
        "globalExposure",
    )
    risk_values = await asyncio.gather(
        *(
            gateway.contract_call(settings.risk_policy_address, f"{name}()")
            for name in risk_names
        )
    )
    risk = dict(zip(risk_names, risk_values, strict=True))
    wallet = payload["positionWallet"]
    relationship_hash = bytes.fromhex(
        relationship["canonicalDefinitionHash"].removeprefix("0x")
    )
    conditions = [
        bytes.fromhex(str(leg["conditionId"]).removeprefix("0x"))
        for leg in payload["solverRequest"]["legs"]
    ]
    schema_hash = keccak(text=ALLOWED_SCHEMA)
    wallet_exposure, relationship_exposure, *market_exposures = await asyncio.gather(
        gateway.contract_call(
            settings.risk_policy_address,
            "walletExposure(address)",
            ["address"],
            [wallet],
        ),
        gateway.contract_call(
            settings.risk_policy_address,
            "relationshipExposure(bytes32)",
            ["bytes32"],
            [relationship_hash],
        ),
        *(
            gateway.contract_call(
                settings.risk_policy_address,
                "marketExposure(bytes32)",
                ["bytes32"],
                [condition],
            )
            for condition in conditions
        ),
    )
    (
        schema_allowed,
        adapter_allowed,
        collateral_allowed,
        originations_paused,
    ) = await asyncio.gather(
        gateway.contract_call(
            settings.risk_policy_address,
            "allowedRelationshipSchemas(bytes32)",
            ["bytes32"],
            [schema_hash],
        ),
        gateway.contract_call(
            settings.risk_policy_address,
            "allowedAdapters(address)",
            ["address"],
            [settings.adapter_address],
        ),
        gateway.contract_call(
            settings.risk_policy_address,
            "allowedCollateral(address)",
            ["address"],
            [settings.collateral_token_address],
        ),
        gateway.contract_call(settings.risk_policy_address, "originationsPaused()"),
    )
    risk.update(
        {
            "walletExposure": {wallet.lower(): wallet_exposure},
            "relationshipExposure": {
                relationship["canonicalDefinitionHash"].lower(): relationship_exposure
            },
            "marketExposure": {
                "0x" + condition.hex(): exposure
                for condition, exposure in zip(
                    conditions, market_exposures, strict=True
                )
            },
            "schemaAllowed": bool(schema_allowed),
            "originationsPaused": bool(originations_paused),
            "adapterAllowed": bool(adapter_allowed),
            "collateralAllowed": bool(collateral_allowed),
        }
    )
    return pool, risk


async def validate_quote_pre_sign(
    payload: dict,
    relationship: dict,
    settings: Any,
    store: Any,
    gateway: Any,
    require_books: Callable[[list[str]], Awaitable[list[dict]]],
) -> dict:
    now = int(time.time())
    request = SolverRequest.model_validate(payload["solverRequest"])
    _validate_relationship(relationship, request, now)
    result, floor = _validate_solver(request)
    reviewed = _validate_legs(request, relationship)
    wallet = payload["positionWallet"].lower()

    if settings.normalized_mode in {"local", "test"}:
        _reject(
            time.time() - float(store.local_market_observed_at)
            > settings.market_freshness_seconds,
            "MARKET_DATA_STALE",
        )
        balances = store.position_balances.get(wallet, {})
        for leg in request.legs:
            _reject(
                int(balances.get(leg.tokenId, 0)) < int(leg.amountAtomic),
                "POSITION_BALANCE_INSUFFICIENT",
            )
        pool = store.pool_preflight
        risk = store.risk_preflight
    else:
        market_list, position_list, wallet_capability = await asyncio.gather(
            gateway.markets(limit=500),
            gateway.positions(wallet),
            gateway.wallet_type(wallet),
        )
        _reject(
            wallet_capability.get("walletType") != "EOA"
            or not wallet_capability.get("executionSupported"),
            "POSITION_WALLET_NOT_AUTHORIZED",
        )
        gamma = {str(item["conditionId"]).lower(): item for item in market_list}
        data_positions = {str(item["tokenId"]): item for item in position_list}
        for leg in request.legs:
            market = gamma.get(leg.conditionId.lower())
            _reject(market is None, "MARKET_METADATA_MISSING")
            _reject(
                time.time() - float(market.get("observedAt", 0))
                > settings.market_freshness_seconds,
                "MARKET_DATA_STALE",
            )
            _reject(
                not market.get("active") or market.get("closed"),
                "MARKET_CLOSED_OR_UNSUPPORTED",
            )
            _reject(
                bool(market.get("negativeRisk")), "UNSUPPORTED_NEGATIVE_RISK_POSITION"
            )
            token_ids = [str(token_id) for token_id in market.get("tokenIds", [])]
            expected_index = 0 if leg.outcome == "YES" else 1
            _reject(
                len(token_ids) != 2 or token_ids[expected_index] != leg.tokenId,
                "MARKET_TOKEN_CONFLICT",
            )
            rpc_balance, payout_denominator = await asyncio.gather(
                gateway.contract_call(
                    settings.conditional_tokens_address,
                    "balanceOf(address,uint256)",
                    ["address", "uint256"],
                    [wallet, int(leg.tokenId)],
                ),
                gateway.contract_call(
                    settings.conditional_tokens_address,
                    "payoutDenominator(bytes32)",
                    ["bytes32"],
                    [bytes.fromhex(leg.conditionId.removeprefix("0x"))],
                ),
            )
            _reject(
                rpc_balance < int(leg.amountAtomic), "POSITION_BALANCE_INSUFFICIENT"
            )
            _reject(payout_denominator != 0, "MARKET_ALREADY_RESOLVED")
            reported = data_positions.get(leg.tokenId)
            _reject(
                reported is None
                or str(reported.get("conditionId", "")).lower()
                != leg.conditionId.lower()
                or str(reported.get("outcome", "")).upper() != leg.outcome
                or int(reported.get("amountAtomic", "0")) < int(leg.amountAtomic),
                "POSITION_DATA_CONFLICT",
            )
            expected = reviewed[leg.conditionId.lower()]
            _reject(
                expected.get("resolutionSource") != market.get("resolutionSource"),
                "MARKET_RULE_SOURCE_CONFLICT",
            )
        snapshots = await require_books([leg.tokenId for leg in request.legs])
        _reject(
            any(snapshot.get("negativeRisk") for snapshot in snapshots),
            "UNSUPPORTED_NEGATIVE_RISK_POSITION",
        )
        pool, risk = await _live_pool_and_risk(settings, gateway, payload, relationship)

    _validate_pool_and_risk(
        payload=payload,
        relationship=relationship,
        settings=settings,
        pool=pool,
        risk=risk,
        floor=floor,
        now=now,
    )
    return {
        "artifactHash": result.artifactHash,
        "solverTimestamp": result.generatedAt,
        "guaranteedFloorAtomic": str(floor),
        "validatedAt": now,
        "checks": {
            "relationship": True,
            "solver": True,
            "positions": True,
            "markets": True,
            "pool": True,
            "risk": True,
        },
    }
