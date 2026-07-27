import os
import asyncio
import time
import unittest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

os.environ["EVENTCLEAR_MODE"] = "local"
from fastapi.testclient import TestClient
from eventclear_api.main import app, polymarket, require_fresh_books, store
from eventclear_api.settings import Settings
from eventclear_api.signer import _recoverable_signature
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak


class ApiTests(unittest.TestCase):
    def setUp(self):
        store.reset()
        self.client = TestClient(app)

    @staticmethod
    def session_headers(address: str) -> dict[str, str]:
        token = f"test-session-{address.lower()}"
        store.create_session(token, address, time.time() + 300)
        return {"authorization": f"Bearer {token}"}

    @staticmethod
    def siwe_message(address: str, nonce: str) -> str:
        issued_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        return (
            "eventclear.local wants you to sign in with your Ethereum account:\n"
            f"{address}\n\n"
            "Sign in to EventClear.\n\n"
            "URI: http://eventclear.local\n"
            "Version: 1\n"
            "Chain ID: 31337\n"
            f"Nonce: {nonce}\n"
            f"Issued At: {issued_at}"
        )

    @staticmethod
    def valid_quote_payload() -> dict:
        return {
            "accountWallet": "0x0000000000000000000000000000000000000001",
            "solverRequest": {
                "relationshipDefinitionHash": "0x" + "ab" * 32,
                "definitionVersion": 3,
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
                "payoutModel": {},
            },
        }

    def request_quote(self, payload: dict | None = None):
        payload = payload or self.valid_quote_payload()
        return self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers(payload["accountWallet"]),
        )

    def test_health_and_correlation(self):
        response = self.client.get(
            "/api/v1/health", headers={"x-correlation-id": "test-id"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-correlation-id"], "test-id")

    def test_admin_requires_authentication(self):
        response = self.client.post("/api/v1/admin/relationships", json={"id": "test"})
        self.assertEqual(response.status_code, 403)

    def test_relationship_creation_is_durable_through_store_interface(self):
        headers = {"x-admin-token": "local-admin"}
        payload = {"id": "new-ladder", "canonicalDefinitionHash": "0x" + "ef" * 32}
        created = self.client.post(
            "/api/v1/admin/relationships", json=payload, headers=headers
        )
        self.assertEqual(created.status_code, 200, created.text)
        fetched = self.client.get("/api/v1/relationships/new-ladder")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["status"], "DRAFT")
        duplicate = self.client.post(
            "/api/v1/admin/relationships", json=payload, headers=headers
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_siwe_nonce_is_single_use_even_after_failed_signature(self):
        nonce = self.client.post("/api/v1/auth/siwe/nonce").json()["nonce"]
        address = "0x0000000000000000000000000000000000000001"
        payload = {
            "nonce": nonce,
            "message": self.siwe_message(address, nonce),
            "signature": "0xdeadbeef",
        }
        first = self.client.post("/api/v1/auth/siwe/verify", json=payload)
        second = self.client.post("/api/v1/auth/siwe/verify", json=payload)
        self.assertEqual(first.status_code, 401)
        self.assertEqual(first.json()["detail"]["code"], "INVALID_SIWE_SIGNATURE")
        self.assertEqual(second.status_code, 401)
        self.assertEqual(second.json()["detail"]["code"], "INVALID_SIWE_NONCE")

    def test_valid_siwe_message_binds_domain_chain_nonce_and_address(self):
        private_key = (
            "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d"
        )
        account = Account.from_key(private_key)
        nonce = self.client.post("/api/v1/auth/siwe/nonce").json()["nonce"]
        message = self.siwe_message(account.address, nonce)
        signature = Account.sign_message(
            encode_defunct(text=message), private_key=private_key
        ).signature.hex()
        response = self.client.post(
            "/api/v1/auth/siwe/verify",
            json={
                "nonce": nonce,
                "message": message,
                "signature": "0x" + signature.removeprefix("0x"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["address"], account.address)

    def test_mainnet_rejects_memory_store(self):
        production = Settings(
            mode="polygon-mainnet", chain_id=137, store_backend="memory"
        )
        with self.assertRaisesRegex(RuntimeError, "EVENTCLEAR_STORE=postgres"):
            production.validate()

    def test_mainnet_rejects_raw_local_signer(self):
        production = Settings(
            mode="polygon-mainnet",
            chain_id=137,
            store_backend="postgres",
            database_url="postgresql://example.invalid/eventclear",
            signer_backend="local",
        )
        with self.assertRaisesRegex(RuntimeError, "RISK_SIGNER_BACKEND=kms"):
            production.validate()

    def test_kms_signature_recovery_encoding(self):
        private_key = (
            "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d"
        )
        digest = keccak(b"eventclear-kms-test")
        signed = Account._sign_hash(digest, private_key=private_key)
        encoded = _recoverable_signature(
            digest, signed.r, signed.s, Account.from_key(private_key).address
        )
        self.assertEqual(len(encoded), 65)
        self.assertIn(encoded[-1], (27, 28))

    def test_unknown_market_structured_error(self):
        response = self.client.get("/api/v1/markets/missing")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "MARKET_NOT_FOUND")

    def test_quote_reruns_solver_and_signs_eip712(self):
        definition_hash = "0x" + "ab" * 32
        conditions = ["0x" + "11" * 32, "0x" + "22" * 32]
        payload = {
            "accountWallet": "0x0000000000000000000000000000000000000001",
            "solverRequest": {
                "relationshipDefinitionHash": definition_hash,
                "definitionVersion": 1,
                "legs": [
                    {
                        "conditionId": conditions[0],
                        "tokenId": "1",
                        "outcome": "YES",
                        "amountAtomic": "100000000",
                    },
                    {
                        "conditionId": conditions[1],
                        "tokenId": "4",
                        "outcome": "NO",
                        "amountAtomic": "100000000",
                    },
                ],
                "payoutModel": {
                    "definitionHash": definition_hash,
                    "definitionVersion": 1,
                    "allowedTokens": {
                        "1": {"conditionId": conditions[0], "outcome": "YES"},
                        "4": {"conditionId": conditions[1], "outcome": "NO"},
                    },
                    "validWorlds": [
                        {
                            "worldId": "below",
                            "assignments": {"band": 0},
                            "payoutsAtomicByToken": {"1": "0", "4": "1000000"},
                        },
                        {
                            "worldId": "middle",
                            "assignments": {"band": 1},
                            "payoutsAtomicByToken": {"1": "1000000", "4": "1000000"},
                        },
                        {
                            "worldId": "above",
                            "assignments": {"band": 2},
                            "payoutsAtomicByToken": {"1": "1000000", "4": "0"},
                        },
                    ],
                },
            },
        }
        response = self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers(payload["accountWallet"]),
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["quote"]["grossAdvance"], "95000000")
        self.assertEqual(body["quote"]["originationFee"], "475000")
        self.assertEqual(body["quote"]["netAdvance"], "94525000")
        self.assertEqual(body["quote"]["earliestResolutionTimestamp"], "1798761599")
        self.assertEqual(body["quote"]["latestResolutionTimestamp"], "1799366399")
        self.assertTrue(body["signature"].startswith("0x"))
        self.assertEqual(len(body["quote"]["bundleHash"]), 66)
        self.assertEqual(len(body["quote"]["walletAuthorizationHash"]), 66)
        self.assertEqual(
            body["walletAuthorization"]["authorization"]["positionWallet"],
            payload["accountWallet"],
        )

    def test_quote_ignores_client_supplied_payout_worlds(self):
        definition_hash = "0x" + "ab" * 32
        payload = {
            "accountWallet": "0x0000000000000000000000000000000000000001",
            "solverRequest": {
                "relationshipDefinitionHash": definition_hash,
                "definitionVersion": 999,
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
                "payoutModel": {
                    "definitionHash": definition_hash,
                    "definitionVersion": 999,
                    "allowedTokens": {
                        "1": {"conditionId": "0x" + "11" * 32, "outcome": "YES"},
                        "4": {"conditionId": "0x" + "22" * 32, "outcome": "NO"},
                    },
                    "validWorlds": [
                        {
                            "worldId": "fabricated",
                            "assignments": {},
                            "payoutsAtomicByToken": {"1": "9000000", "4": "9000000"},
                        }
                    ],
                },
            },
        }
        response = self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers(payload["accountWallet"]),
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["quote"]["guaranteedFloor"], "100000000")
        self.assertEqual(
            response.json()["requestPayload"]["solverRequest"]["definitionVersion"], 3
        )

    def test_quote_ignores_client_supplied_resolution_window(self):
        payload = {
            "accountWallet": "0x0000000000000000000000000000000000000001",
            "earliestResolutionTimestamp": 1,
            "latestResolutionTimestamp": 2,
            "solverRequest": {
                "relationshipDefinitionHash": "0x" + "ab" * 32,
                "definitionVersion": 3,
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
                "payoutModel": {},
            },
        }
        response = self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers(payload["accountWallet"]),
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["quote"]["earliestResolutionTimestamp"], "1798761599")
        self.assertEqual(body["quote"]["latestResolutionTimestamp"], "1799366399")
        self.assertEqual(
            body["requestPayload"]["earliestResolutionTimestamp"], 1798761599
        )
        self.assertEqual(
            body["requestPayload"]["latestResolutionTimestamp"], 1799366399
        )

    def test_quote_preflight_reports_checks_and_revalidates_refresh(self):
        response = self.request_quote()
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(all(body["preSignValidation"]["checks"].values()))
        self.assertEqual(
            body["preSignValidation"]["artifactHash"],
            body["solverResult"]["artifactHash"],
        )

        store.position_balances["0x0000000000000000000000000000000000000001"]["1"] = 0
        refreshed = self.client.post(
            f"/api/v1/quotes/{body['id']}/refresh",
            headers=self.session_headers("0x0000000000000000000000000000000000000001"),
        )
        self.assertEqual(refreshed.status_code, 422)
        self.assertEqual(
            refreshed.json()["detail"]["code"],
            "POSITION_BALANCE_INSUFFICIENT",
        )

    def test_quote_rejects_insufficient_rpc_equivalent_balance(self):
        store.position_balances["0x0000000000000000000000000000000000000001"]["1"] = (
            99_999_999
        )
        response = self.request_quote()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"]["code"], "POSITION_BALANCE_INSUFFICIENT"
        )

    def test_quote_rejects_resolved_and_negative_risk_markets(self):
        store.relationships[0]["reviewedMarkets"][0]["resolved"] = True
        resolved = self.request_quote()
        self.assertEqual(resolved.status_code, 422)
        self.assertEqual(resolved.json()["detail"]["code"], "MARKET_ALREADY_RESOLVED")

        store.reset()
        store.relationships[0]["reviewedMarkets"][0]["negativeRisk"] = True
        negative_risk = self.request_quote()
        self.assertEqual(negative_risk.status_code, 422)
        self.assertEqual(
            negative_risk.json()["detail"]["code"],
            "UNSUPPORTED_NEGATIVE_RISK_POSITION",
        )

    def test_quote_rejects_suspended_relationship(self):
        store.relationships[0]["status"] = "SUSPENDED"
        response = self.request_quote()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "RELATIONSHIP_SUSPENDED")

    def test_quote_rejects_pool_liquidity_and_market_exposure(self):
        store.pool_preflight["liquidAssets"] = 0
        liquidity = self.request_quote()
        self.assertEqual(liquidity.status_code, 422)
        self.assertEqual(
            liquidity.json()["detail"]["code"], "POOL_LIQUIDITY_INSUFFICIENT"
        )

        store.reset()
        store.risk_preflight["perMarketExposureCap"] = 1
        exposure = self.request_quote()
        self.assertEqual(exposure.status_code, 422)
        self.assertEqual(exposure.json()["detail"]["code"], "MARKET_EXPOSURE_LIMIT")

    def test_quote_rejects_excessive_resolution_duration(self):
        store.risk_preflight["maximumBundleDuration"] = 1
        response = self.request_quote()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "BUNDLE_DURATION_EXCEEDED")

    def test_quote_rejects_stale_market_data_and_paused_originations(self):
        store.local_market_observed_at = time.time() - 31
        stale = self.request_quote()
        self.assertEqual(stale.status_code, 422)
        self.assertEqual(stale.json()["detail"]["code"], "MARKET_DATA_STALE")

        store.reset()
        store.risk_preflight["originationsPaused"] = True
        paused = self.request_quote()
        self.assertEqual(paused.status_code, 422)
        self.assertEqual(paused.json()["detail"]["code"], "ORIGINATIONS_PAUSED")

    def test_quote_rejects_siwe_and_position_wallet_mismatch(self):
        payload = {
            "accountWallet": "0x0000000000000000000000000000000000000001",
            "positionWallet": "0x0000000000000000000000000000000000000002",
            "solverRequest": {
                "relationshipDefinitionHash": "0x" + "ab" * 32,
                "definitionVersion": 3,
                "legs": [],
                "payoutModel": {},
            },
        }
        wrong_session = self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers("0x0000000000000000000000000000000000000003"),
        )
        self.assertEqual(wrong_session.status_code, 403)
        self.assertEqual(
            wrong_session.json()["detail"]["code"], "SIWE_ADDRESS_MISMATCH"
        )

        wrong_position_wallet = self.client.post(
            "/api/v1/quotes",
            json=payload,
            headers=self.session_headers(payload["accountWallet"]),
        )
        self.assertEqual(wrong_position_wallet.status_code, 422)
        self.assertEqual(
            wrong_position_wallet.json()["detail"]["code"],
            "POSITION_WALLET_NOT_AUTHORIZED",
        )

    def test_transaction_preparation_returns_executable_calldata(self):
        receiver = "0x0000000000000000000000000000000000000001"
        headers = {
            **self.session_headers(receiver),
            "Idempotency-Key": "deposit-test-0001",
        }
        deposit = self.client.post(
            "/api/v1/pool/prepare-deposit",
            json={"amountAtomic": "1000000", "receiver": receiver},
            headers=headers,
        )
        self.assertEqual(deposit.status_code, 200, deposit.text)
        self.assertTrue(
            deposit.json()["transactionRequest"]["data"].startswith("0x6e553f65")
        )
        self.assertFalse(deposit.json().get("requiresWalletEncoding", False))

        redemption = self.client.post(
            "/api/v1/claims/principal-418/prepare-redemption",
            json={"amountAtomic": "1000000"},
            headers={
                **self.session_headers(receiver),
                "Idempotency-Key": "redemption-test-0001",
            },
        )
        self.assertEqual(redemption.status_code, 200, redemption.text)
        self.assertNotEqual(redemption.json()["transactionRequest"]["data"], None)
        self.assertFalse(redemption.json()["requiresWalletEncoding"])

    def test_transaction_preparation_is_idempotent_and_actor_bound(self):
        receiver = "0x0000000000000000000000000000000000000001"
        headers = {
            **self.session_headers(receiver),
            "Idempotency-Key": "deposit-idempotent-0001",
        }
        payload = {"amountAtomic": "1000000", "receiver": receiver}
        first = self.client.post(
            "/api/v1/pool/prepare-deposit", json=payload, headers=headers
        )
        second = self.client.post(
            "/api/v1/pool/prepare-deposit", json=payload, headers=headers
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json(), second.json())

        changed = self.client.post(
            "/api/v1/pool/prepare-deposit",
            json={"amountAtomic": "2000000", "receiver": receiver},
            headers=headers,
        )
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()["detail"]["code"], "IDEMPOTENCY_KEY_REUSED")

    def test_open_bundle_preparation_returns_only_protocol_destinations(self):
        quote_response = self.request_quote()
        self.assertEqual(quote_response.status_code, 200, quote_response.text)
        quote_id = quote_response.json()["id"]
        address = "0x0000000000000000000000000000000000000001"
        signature = "0x" + "11" * 65

        approval = self.client.post(
            "/api/v1/bundles/open/prepare",
            json={"quoteId": quote_id, "walletAuthorizationSignature": signature},
            headers={
                **self.session_headers(address),
                "Idempotency-Key": "open-approval-0001",
            },
        )
        self.assertEqual(approval.status_code, 200, approval.text)
        self.assertEqual(approval.json()["action"], "APPROVE_POSITIONS")
        self.assertEqual(
            approval.json()["transactionRequest"]["to"].lower(),
            "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
        )

        store.erc1155_approvals[
            (address, "0x0000000000000000000000000000000000001000")
        ] = True
        opening = self.client.post(
            "/api/v1/bundles/open/prepare",
            json={"quoteId": quote_id, "walletAuthorizationSignature": signature},
            headers={
                **self.session_headers(address),
                "Idempotency-Key": "open-bundle-0002",
            },
        )
        self.assertEqual(opening.status_code, 200, opening.text)
        self.assertEqual(opening.json()["action"], "OPEN_BUNDLE")
        self.assertEqual(
            opening.json()["transactionRequest"]["to"].lower(),
            "0x0000000000000000000000000000000000001000",
        )
        self.assertEqual(
            opening.json()["expectedSelector"],
            opening.json()["transactionRequest"]["data"][:10],
        )

    def test_public_config_exposes_only_execution_addresses_and_mode(self):
        response = self.client.get("/api/v1/config/public")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["chainId"], 31337)
        self.assertTrue(body["mainnetExecution"])
        self.assertIn("fundingPoolAddress", body)
        self.assertNotIn("adminApiToken", body)

    def test_fresh_persistent_book_cache_survives_temporary_clob_failure(self):
        token_id = "123"
        store.save_market_snapshot(
            token_id,
            {
                "tokenId": token_id,
                "observedAt": time.time(),
                "stale": False,
                "source": "clob-live",
            },
        )
        with patch.object(
            polymarket,
            "order_book",
            AsyncMock(side_effect=RuntimeError("POLYMARKET_READ_UNAVAILABLE")),
        ):
            snapshots = asyncio.run(require_fresh_books([token_id]))
        self.assertEqual(snapshots[0]["source"], "clob-persistent-cache")
        self.assertFalse(snapshots[0]["stale"])


if __name__ == "__main__":
    unittest.main()
