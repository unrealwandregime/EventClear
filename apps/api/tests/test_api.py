import os
import unittest

os.environ["EVENTCLEAR_MODE"] = "local"
from fastapi.testclient import TestClient
from eventclear_api.main import app, store


class ApiTests(unittest.TestCase):
    def setUp(self):
        store.reset()
        self.client = TestClient(app)

    def test_health_and_correlation(self):
        response = self.client.get("/api/v1/health", headers={"x-correlation-id": "test-id"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-correlation-id"], "test-id")

    def test_admin_requires_authentication(self):
        response = self.client.post("/api/v1/admin/relationships", json={"id": "test"})
        self.assertEqual(response.status_code, 403)

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
                    {"conditionId": conditions[0], "tokenId": "1", "outcome": "YES", "amountAtomic": "100000000"},
                    {"conditionId": conditions[1], "tokenId": "4", "outcome": "NO", "amountAtomic": "100000000"},
                ],
                "payoutModel": {
                    "definitionHash": definition_hash,
                    "definitionVersion": 1,
                    "allowedTokens": {
                        "1": {"conditionId": conditions[0], "outcome": "YES"},
                        "4": {"conditionId": conditions[1], "outcome": "NO"},
                    },
                    "validWorlds": [
                        {"worldId": "below", "assignments": {"band": 0}, "payoutsAtomicByToken": {"1": "0", "4": "1000000"}},
                        {"worldId": "middle", "assignments": {"band": 1}, "payoutsAtomicByToken": {"1": "1000000", "4": "1000000"}},
                        {"worldId": "above", "assignments": {"band": 2}, "payoutsAtomicByToken": {"1": "1000000", "4": "0"}},
                    ],
                },
            },
        }
        response = self.client.post("/api/v1/quotes", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["quote"]["advanceAmount"], "93500000")
        self.assertTrue(body["signature"].startswith("0x"))
        self.assertEqual(len(body["quote"]["bundleHash"]), 66)


if __name__ == "__main__":
    unittest.main()
