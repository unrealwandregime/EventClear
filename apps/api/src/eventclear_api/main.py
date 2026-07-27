from __future__ import annotations

import time
import uuid
import secrets
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from eth_account import Account
from eth_account.messages import encode_defunct

from eventclear_solver.engine import solve
from eventclear_solver.models import SolverRequest

from .quote import issue_quote
from .repository import create_store
from .seed import POSITIONS
from .settings import Settings

settings = Settings()
settings.validate()
store = create_store(settings)
REQUESTS = Counter("eventclear_api_requests_total", "API requests", ["method", "path", "status"])
LATENCY = Histogram("eventclear_api_latency_seconds", "API request latency", ["path"])
rate_windows: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    yield


app = FastAPI(title="EventClear API", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def controls(request: Request, call_next):
    started = time.monotonic()
    correlation_id = request.headers.get("x-correlation-id", str(uuid.uuid4()))
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = rate_windows[key]
    while window and window[0] < now - 60:
        window.popleft()
    if len(window) >= 120:
        return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "correlationId": correlation_id}})
    window.append(now)
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["content-security-policy"] = "default-src 'self'"
    REQUESTS.labels(request.method, request.url.path, response.status_code).inc()
    LATENCY.labels(request.url.path).observe(time.monotonic() - started)
    return response


def admin(x_admin_token: str | None = Header(default=None)) -> str:
    expected = __import__("os").environ.get("ADMIN_API_TOKEN", "local-admin")
    if x_admin_token != expected:
        raise HTTPException(status_code=403, detail={"code": "ADMIN_REQUIRED"})
    return "admin"


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "mode": settings.mode, "database": "configured", "chainId": settings.chain_id}


@app.get("/api/v1/config/public")
def public_config():
    return {"mode": settings.mode, "chainId": settings.chain_id, "vaultAddress": settings.vault_address, "mainnetExecution": settings.mode == "polygon-mainnet"}


@app.post("/api/v1/auth/siwe/nonce")
def siwe_nonce():
    nonce = secrets.token_urlsafe(18)
    store.create_siwe_nonce(nonce, time.time() + 300)
    return {"nonce": nonce, "expiresIn": 300}


@app.post("/api/v1/auth/siwe/verify")
def siwe_verify(payload: dict):
    message = payload.get("message", "")
    signature = payload.get("signature", "")
    nonce = payload.get("nonce", "")
    if not store.consume_siwe_nonce(nonce, time.time()) or f"Nonce: {nonce}" not in message:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_NONCE"})
    try:
        recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception as exc:
        raise HTTPException(401, detail={"code": "INVALID_SIWE_SIGNATURE"}) from exc
    token = secrets.token_urlsafe(32)
    store.create_session(token, recovered, time.time() + 3600)
    return {"sessionToken": token, "address": recovered, "expiresIn": 3600}


@app.get("/api/v1/markets")
def markets():
    return {"data": store.list_markets(), "stale": False}


@app.get("/api/v1/markets/{condition_id}")
def market(condition_id: str):
    item = store.get_market(condition_id)
    if not item:
        raise HTTPException(404, detail={"code": "MARKET_NOT_FOUND"})
    return item


@app.get("/api/v1/markets/{condition_id}/rules")
def market_rules(condition_id: str):
    market(condition_id)
    return {"conditionId": condition_id, "ruleHash": "0x" + "cd" * 32, "source": "seed://reviewed-rules", "observationSemanticsComplete": True}


@app.get("/api/v1/wallets/{address}/positions")
def positions(address: str):
    return {"signerAddress": address, "accountWallet": address, "walletType": "EOA", "positionHoldingAddress": address, "positions": POSITIONS}


@app.get("/api/v1/wallets/{address}/eligible-bundles")
def eligible(address: str):
    return {"accountWallet": address, "candidates": [{"relationshipId": "btc-close-ladder", "status": "ELIGIBLE", "guaranteedFloorAtomic": "100000000", "estimatedAdvanceAtomic": "93500000"}]}


@app.post("/api/v1/bundles/analyze")
def analyze(request: SolverRequest):
    result = solve(request)
    if not result.isSatisfiable:
        raise HTTPException(422, detail={"code": "SOLVER_REJECTED", "reasons": result.rejectionReasons})
    return result


@app.post("/api/v1/quotes")
def quote(payload: dict):
    relationship = store.get_relationship_by_hash(
        payload.get("solverRequest", {}).get("relationshipDefinitionHash", "")
    )
    if not relationship or relationship["status"] != "APPROVED":
        raise HTTPException(422, detail={"code": "RELATIONSHIP_NOT_ACTIVE"})
    try:
        result = issue_quote(payload, settings, store.allocate_quote_nonce())
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, detail={"code": "QUOTE_REJECTED", "reason": str(exc)}) from exc
    store.save_quote(result["id"], result)
    return result


@app.get("/api/v1/quotes/{quote_id}")
def get_quote(quote_id: str):
    result = store.get_quote(quote_id)
    if result is None:
        raise HTTPException(404, detail={"code": "QUOTE_NOT_FOUND"})
    return result


@app.get("/api/v1/bundles")
def bundles():
    return {"data": store.list_bundles()}


@app.get("/api/v1/bundles/{bundle_id}")
def bundle(bundle_id: str):
    item = store.get_bundle(bundle_id)
    if not item:
        raise HTTPException(404, detail={"code": "BUNDLE_NOT_FOUND"})
    return item


@app.post("/api/v1/bundles/{bundle_id}/prepare-settlement")
def prepare_settlement(bundle_id: str):
    return {"bundleId": bundle_id, "ready": False, "unresolvedConditions": ["btc-100", "btc-150"]}


@app.post("/api/v1/bundles/{bundle_id}/settle")
def settle(bundle_id: str):
    return {"bundleId": bundle_id, "transactionRequest": None, "reason": "CONDITIONS_UNRESOLVED"}


@app.get("/api/v1/relationships")
def relationships():
    return {"data": store.list_relationships()}


@app.get("/api/v1/relationships/{relationship_id}")
def relationship(relationship_id: str):
    item = store.get_relationship(relationship_id)
    if not item:
        raise HTTPException(404, detail={"code": "RELATIONSHIP_NOT_FOUND"})
    return item


@app.post("/api/v1/admin/relationships")
def create_relationship(payload: dict, actor: str = Depends(admin)):
    if not payload.get("id"):
        raise HTTPException(422, detail={"code": "RELATIONSHIP_ID_REQUIRED"})
    item = {**payload, "status": "DRAFT"}
    try:
        store.create_relationship(item)
    except ValueError as exc:
        raise HTTPException(409, detail={"code": str(exc)}) from exc
    store.append_audit_log({"actor": actor, "action": "RELATIONSHIP_CREATED", "target": item["id"]})
    return item


@app.post("/api/v1/admin/relationships/{relationship_id}/{action}")
def relationship_action(relationship_id: str, action: str, actor: str = Depends(admin)):
    if action not in {"review", "approve", "suspend"}:
        raise HTTPException(404, detail={"code": "ACTION_NOT_FOUND"})
    item = store.set_relationship_status(
        relationship_id,
        {"review": "REVIEW", "approve": "APPROVED", "suspend": "SUSPENDED"}[action],
    )
    if item is None:
        raise HTTPException(404, detail={"code": "RELATIONSHIP_NOT_FOUND"})
    store.append_audit_log({"actor": actor, "action": f"RELATIONSHIP_{action.upper()}", "target": relationship_id})
    return item


@app.get("/api/v1/pool")
def pool():
    return {"totalAssetsAtomic": "780000000000", "liquidAtomic": "298000000000", "outstandingAdvanceCostBasisAtomic": "482000000000", "utilizationBps": 6179, "realizedYieldAtomic": "9270000000", "depositCapAtomic": "1000000000000"}


@app.get("/api/v1/pool/history")
def pool_history():
    return {"data": [{"date": "2026-07-27", "totalAssetsAtomic": "780000000000", "utilizationBps": 6179}]}


@app.get("/api/v1/protocol/metrics")
def protocol_metrics():
    return {"activeBundles": 418, "guaranteedCollateralAtomic": "482640000000", "capitalUnlockedAtomic": "451268400000", "activeRelationships": 24}


@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
