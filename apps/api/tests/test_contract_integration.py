from __future__ import annotations

import asyncio
import copy
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak

from eventclear_api.calldata import open_bundle, set_approval_for_all
from eventclear_api.polymarket import PolymarketReadGateway
from eventclear_api.preflight import (
    QuotePreflightError,
    _live_pool_and_risk,
    _validate_pool_and_risk,
    validate_quote_pre_sign,
)
from eventclear_api.quote import issue_quote
from eventclear_api.seed import BTC_SOLVER_DEFINITION, RELATIONSHIPS


pytestmark = [
    pytest.mark.contract_integration,
    pytest.mark.skipif(
        os.getenv("API_CONTRACT_INTEGRATION") != "1",
        reason="run through make test-api-contract-integration",
    ),
]

ROOT = Path(__file__).resolve().parents[3]
BORROWER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
BORROWER = Account.from_key(BORROWER_KEY).address


def _deployed_addresses() -> dict[str, str]:
    broadcast = json.loads(
        (
            ROOT
            / "packages"
            / "contracts"
            / "broadcast"
            / "DeployLocal.s.sol"
            / "31337"
            / "run-latest.json"
        ).read_text(encoding="utf-8")
    )
    return {
        transaction["contractName"]: transaction["contractAddress"]
        for transaction in broadcast["transactions"]
        if transaction.get("transactionType") == "CREATE"
        and transaction.get("contractName")
        and transaction.get("contractAddress")
    }


class ContractBackedGateway(PolymarketReadGateway):
    async def markets(self, limit: int = 100) -> list[dict]:
        now = time.time()
        return [
            {
                "conditionId": "0x" + "11" * 32,
                "tokenIds": ["1", "2"],
                "active": True,
                "closed": False,
                "negativeRisk": False,
                "resolutionSource": "official-index",
                "observedAt": now,
            },
            {
                "conditionId": "0x" + "22" * 32,
                "tokenIds": ["3", "4"],
                "active": True,
                "closed": False,
                "negativeRisk": False,
                "resolutionSource": "official-index",
                "observedAt": now,
            },
        ]

    async def positions(self, address: str) -> list[dict]:
        assert address.lower() == BORROWER.lower()
        return [
            {
                "conditionId": "0x" + "11" * 32,
                "tokenId": "1",
                "outcome": "YES",
                "amountAtomic": "100000000",
            },
            {
                "conditionId": "0x" + "22" * 32,
                "tokenId": "4",
                "outcome": "NO",
                "amountAtomic": "100000000",
            },
        ]

    async def wallet_type(self, address: str) -> dict:
        result = await super().wallet_type(address)
        assert result["walletType"] == "EOA"
        return result


def _settings(addresses: dict[str, str]) -> SimpleNamespace:
    return SimpleNamespace(
        normalized_mode="staging",
        funding_pool_address=addresses["EventClearFundingPool"],
        risk_policy_address=addresses["RiskPolicy"],
        relationship_registry_address=addresses["RelationshipRegistry"],
        conditional_tokens_address=addresses["MockConditionalTokens"],
        collateral_token_address=addresses["MockPUSD"],
        adapter_address=addresses["MockCTFAdapter"],
        vault_address=addresses["EventClearVault"],
        advance_ratio_bps=9_500,
        origination_fee_bps=50,
        market_freshness_seconds=30,
        chain_id=31337,
        quote_lifetime_seconds=300,
        signer_backend="local",
        signer_key=BORROWER_KEY,
    )


def _payload() -> tuple[dict, dict]:
    relationship = copy.deepcopy(RELATIONSHIPS[0])
    request = {
        "relationshipDefinitionHash": relationship["canonicalDefinitionHash"],
        "definitionVersion": relationship["version"],
        "legs": [
            {
                "conditionId": "0x" + "11" * 32,
                "tokenId": "1",
                "outcome": "YES",
                "amountAtomic": "100000000",
            },
            {
                "conditionId": "0x" + "22" * 32,
                "tokenId": "4",
                "outcome": "NO",
                "amountAtomic": "100000000",
            },
        ],
        "payoutModel": copy.deepcopy(BTC_SOLVER_DEFINITION),
    }
    return (
        {
            "accountWallet": BORROWER,
            "borrower": BORROWER,
            "positionWallet": BORROWER,
            "earliestResolutionTimestamp": relationship["earliestResolutionTimestamp"],
            "latestResolutionTimestamp": relationship["latestResolutionTimestamp"],
            "solverRequest": request,
        },
        relationship,
    )


async def _receipt(gateway: PolymarketReadGateway, transaction_hash: str) -> dict:
    import httpx

    for _ in range(40):
        async with httpx.AsyncClient() as client:
            response = await client.post(
                gateway.rpc_urls[0],
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "eth_getTransactionReceipt",
                    "params": [transaction_hash],
                },
            )
        receipt = response.json()["result"]
        if receipt is not None:
            assert int(receipt["status"], 16) == 1
            return receipt
        await asyncio.sleep(0.1)
    raise AssertionError(f"transaction receipt not mined: {transaction_hash}")


def test_python_quote_and_transaction_pipeline_uses_deployed_contracts() -> None:
    addresses = _deployed_addresses()
    settings = _settings(addresses)
    payload, relationship = _payload()
    gateway = ContractBackedGateway(
        gamma_url="http://unused.invalid",
        data_url="http://unused.invalid",
        clob_url="http://unused.invalid",
        rpc_urls=(os.environ["API_INTEGRATION_RPC_URL"],),
    )

    async def verify() -> None:
        async def fresh_books(token_ids: list[str]) -> list[dict]:
            return [
                {"tokenId": token_id, "negativeRisk": False} for token_id in token_ids
            ]

        preflight = await validate_quote_pre_sign(
            payload,
            relationship,
            settings,
            object(),
            gateway,
            fresh_books,
        )
        assert preflight["checks"] == {
            "relationship": True,
            "solver": True,
            "positions": True,
            "markets": True,
            "pool": True,
            "risk": True,
        }
        issued = issue_quote(
            payload,
            settings,
            1,
            solver_timestamp=preflight["solverTimestamp"],
        )
        assert issued["riskSigner"].lower() == BORROWER.lower()

        approval = set_approval_for_all(settings.vault_address)
        await gateway.simulate_transaction(
            sender=BORROWER,
            to=settings.conditional_tokens_address,
            data=approval,
        )
        approval_hash = await gateway.rpc(
            "eth_sendTransaction",
            [
                {
                    "from": BORROWER,
                    "to": settings.conditional_tokens_address,
                    "data": approval,
                }
            ],
        )
        await _receipt(gateway, approval_hash)

        typed = issued["walletAuthorization"]["typedData"]
        authorization = encode_typed_data(
            typed["domain"], typed["types"], typed["message"]
        )
        authorization_signature = Account.sign_message(
            authorization, private_key=BORROWER_KEY
        ).signature.hex()
        bundle_data = open_bundle(
            issued["quote"],
            issued["signature"],
            issued["walletAuthorization"]["authorization"],
            authorization_signature,
            payload["solverRequest"]["legs"],
            relationship["version"],
        )
        await gateway.simulate_transaction(
            sender=BORROWER,
            to=settings.vault_address,
            data=bundle_data,
        )
        bundle_hash = await gateway.rpc(
            "eth_sendTransaction",
            [{"from": BORROWER, "to": settings.vault_address, "data": bundle_data}],
        )
        receipt = await _receipt(gateway, bundle_hash)
        event_topics = {
            log["topics"][0].lower() for log in receipt["logs"] if log.get("topics")
        }
        assert (
            "0x"
            + keccak(
                text="AdvanceFunded(uint256,address,uint256,uint256,uint256)"
            ).hex()
        ).lower() in event_topics
        assert await gateway.contract_call(
            settings.funding_pool_address, "outstandingAdvanceCostBasis()"
        ) == int(issued["quote"]["grossAdvance"])

        pool, risk = await _live_pool_and_risk(settings, gateway, payload, relationship)
        assert risk["collateralAllowed"] and risk["adapterAllowed"]
        assert pool["bytecodeExists"]

    asyncio.run(verify())


def test_live_preflight_rejection_matrix_is_fail_closed() -> None:
    addresses = _deployed_addresses()
    settings = _settings(addresses)
    payload, relationship = _payload()
    gateway = ContractBackedGateway(
        gamma_url="http://unused.invalid",
        data_url="http://unused.invalid",
        clob_url="http://unused.invalid",
        rpc_urls=(os.environ["API_INTEGRATION_RPC_URL"],),
    )

    async def verify() -> None:
        # This test runs after a funded bundle may exist; load canonical values
        # from the deployed contracts and test each rejection independently.
        pool, risk = await _live_pool_and_risk(settings, gateway, payload, relationship)
        now = int(time.time())

        cases = [
            ("COLLATERAL_NOT_ALLOWLISTED", "risk", "collateralAllowed", False),
            ("ADAPTER_NOT_ALLOWLISTED", "risk", "adapterAllowed", False),
            (
                "RELATIONSHIP_SCHEMA_NOT_ALLOWLISTED",
                "risk",
                "schemaAllowed",
                False,
            ),
            ("ORIGINATIONS_PAUSED", "risk", "originationsPaused", True),
            ("POOL_LIQUIDITY_INSUFFICIENT", "pool", "liquidAssets", 0),
            (
                "POOL_UTILIZATION_LIMIT",
                "pool",
                "outstandingAdvanceCostBasis",
                int(pool["totalAssets"]),
            ),
        ]
        for code, target, key, value in cases:
            candidate_pool, candidate_risk = copy.deepcopy(pool), copy.deepcopy(risk)
            (candidate_pool if target == "pool" else candidate_risk)[key] = value
            with pytest.raises(QuotePreflightError, match=code):
                _validate_pool_and_risk(
                    payload=payload,
                    relationship=relationship,
                    settings=settings,
                    pool=candidate_pool,
                    risk=candidate_risk,
                    floor=100_000_000,
                    now=now,
                )

        exposure_cases = [
            ("WALLET_EXPOSURE_LIMIT", "walletExposure", BORROWER.lower()),
            (
                "MARKET_EXPOSURE_LIMIT",
                "marketExposure",
                payload["solverRequest"]["legs"][0]["conditionId"].lower(),
            ),
            (
                "RELATIONSHIP_EXPOSURE_LIMIT",
                "relationshipExposure",
                relationship["canonicalDefinitionHash"].lower(),
            ),
        ]
        for code, key, identifier in exposure_cases:
            candidate = copy.deepcopy(risk)
            candidate[key][identifier] = int(
                candidate[f"per{key[:-8].title()}ExposureCap"]
            )
            with pytest.raises(QuotePreflightError, match=code):
                _validate_pool_and_risk(
                    payload=payload,
                    relationship=relationship,
                    settings=settings,
                    pool=pool,
                    risk=candidate,
                    floor=100_000_000,
                    now=now,
                )

        candidate = copy.deepcopy(risk)
        candidate["globalExposure"] = int(candidate["globalExposureCap"])
        with pytest.raises(QuotePreflightError, match="GLOBAL_EXPOSURE_LIMIT"):
            _validate_pool_and_risk(
                payload=payload,
                relationship=relationship,
                settings=settings,
                pool=pool,
                risk=candidate,
                floor=100_000_000,
                now=now,
            )

        long_relationship = copy.deepcopy(relationship)
        long_relationship["latestResolutionTimestamp"] = (
            now + int(risk["maximumBundleDuration"]) + 1
        )
        with pytest.raises(QuotePreflightError, match="BUNDLE_DURATION_EXCEEDED"):
            _validate_pool_and_risk(
                payload=payload,
                relationship=long_relationship,
                settings=settings,
                pool=pool,
                risk=risk,
                floor=100_000_000,
                now=now,
            )

        for field, code in [
            ("funding_pool_address", "POOL_CONTRACT_NOT_DEPLOYED"),
            ("risk_policy_address", "RISK_POLICY_NOT_DEPLOYED"),
            ("relationship_registry_address", "RELATIONSHIP_REGISTRY_NOT_DEPLOYED"),
        ]:
            missing = copy.copy(settings)
            setattr(missing, field, "0x0000000000000000000000000000000000000001")
            with pytest.raises(QuotePreflightError, match=code):
                await _live_pool_and_risk(missing, gateway, payload, relationship)

    asyncio.run(verify())
