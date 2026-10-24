"""Additional fail-closed controls for the isolated, zero-cost testnet mode."""

import os
from functools import lru_cache
from urllib.parse import urlparse

from eth_account import Account
from eth_utils import is_address


@lru_cache(maxsize=1)
def known_development_addresses():
    Account.enable_unaudited_hdwallet_features()
    addresses = {
        Account.from_mnemonic(
            "test test test test test test test test test test test junk",
            account_path=f"m/44'/60'/0'/0/{index}",
        ).address.lower()
        for index in range(20)
    }
    addresses.add(
        Account.from_key(
            "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d"
        ).address.lower()
    )
    return addresses


def validate_prototype(settings):
    missing = []
    for name, expected in {
        "TESTNET_ASSETS_ONLY": "true",
        "ENABLE_MAINNET_EXECUTION": "false",
        "PUBLIC_CAPITAL_ACTIVATED": "false",
        "PROTOTYPE_MAX_MONTHLY_COST_USD": "0",
    }.items():
        if os.getenv(name) != expected:
            missing.append(name)
    if settings.chain_id not in {80002, 11155111}:
        missing.append("APPROVED_TESTNET_REQUIRED")
    if settings.signer_backend != "local":
        missing.append("LOCAL_TESTNET_SIGNER_REQUIRED")
    try:
        key = os.environ["RISK_SIGNER_PRIVATE_KEY"]
        signer = Account.from_key(key).address.lower()
        if signer in known_development_addresses():
            missing.append("DEVELOPMENT_SIGNER_PROHIBITED")
        if signer != settings.signer_address.lower():
            missing.append("SIGNER_ADDRESS_MISMATCH")
        role_addresses = set()
        for role in ("DEPLOYER", "LP", "TESTER", "ADMIN"):
            address = os.getenv(f"PROTOTYPE_{role}_ADDRESS", "").lower()
            if (
                not is_address(address)
                or int(address, 16) == 0
                or address in known_development_addresses()
            ):
                missing.append(f"DEDICATED_{role}_ADDRESS_REQUIRED")
            role_addresses.add(address)
        if len(role_addresses | {signer}) != 5:
            missing.append("SEPARATE_PROTOTYPE_ACTORS_REQUIRED")
        for role, allowlist in (
            ("LP", settings.lp_allowlist),
            ("TESTER", settings.tester_allowlist),
            ("ADMIN", settings.admin_allowlist),
        ):
            if os.getenv(f"PROTOTYPE_{role}_ADDRESS", "").lower() not in allowlist:
                missing.append(f"{role}_ALLOWLIST_REQUIRED")
    except (KeyError, ValueError):
        missing.append("DEDICATED_SIGNER_REQUIRED")
    if len(settings.admin_api_token) < 32:
        missing.append("ADMIN_TOKEN_STRONG")
    if len(os.getenv("SIWE_SESSION_SECRET", "")) < 32:
        missing.append("SESSION_SECRET_STRONG")
    if len(settings.staging_access_token) < 32:
        missing.append("ACCESS_TOKEN_STRONG")
    if not settings.siwe_uri.startswith("https://"):
        missing.append("SIWE_HTTPS_REQUIRED")
    if not settings.redis_url.startswith("rediss://"):
        missing.append("REDIS_TLS_REQUIRED")
    if not settings.database_url.startswith(("postgresql://", "postgres://")):
        missing.append("POSTGRES_REQUIRED")
    urls = settings.polygon_rpc_urls
    if not urls or any(urlparse(url).scheme != "https" for url in urls):
        missing.append("HTTPS_RPC_REQUIRED")
    if len(set(urls)) < 2 and os.getenv("RPC_REDUNDANCY_DEGRADED") != "true":
        missing.append("ACKNOWLEDGE_RPC_REDUNDANCY_DEGRADED")
    if settings.solver_url != "http://127.0.0.1:8001":
        missing.append("LOOPBACK_SOLVER_REQUIRED")
    if missing:
        raise RuntimeError("PROTOTYPE_SAFETY_GATE_FAILED:" + ",".join(missing))
