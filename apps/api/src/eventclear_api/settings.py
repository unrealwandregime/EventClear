from __future__ import annotations

import os
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from eth_utils import is_checksum_address


CONTROLLED_PRODUCTION_GATES = (
    "ENABLE_MAINNET_EXECUTION",
    "PRODUCTION_MANIFEST_APPROVED",
    "CONTRACTS_DEPLOYED",
    "CONTRACTS_VERIFIED",
    "RISK_SIGNER_CONFIGURED",
    "ADMIN_MULTISIG_CONFIGURED",
    "TREASURY_MULTISIG_CONFIGURED",
    "RPC_FAILOVER_CONFIGURED",
    "MONITORING_CONFIGURED",
    "ALLOWLIST_CONFIGURED",
    "CAPS_CONFIGURED",
    "INDEPENDENT_SECURITY_REVIEW_RECORDED",
    "LEGAL_RELEASE_APPROVED",
)


@dataclass(frozen=True)
class Settings:
    mode: str = os.getenv("EVENTCLEAR_MODE", "local")
    store_backend: str = os.getenv("EVENTCLEAR_STORE", "memory")
    database_url: str = os.getenv("DATABASE_URL", "")
    redis_url: str = os.getenv("REDIS_URL", "")
    admin_api_token: str = os.getenv("ADMIN_API_TOKEN", "local-admin")
    siwe_domain: str = os.getenv("SIWE_DOMAIN", "eventclear.local")
    siwe_uri: str = os.getenv("SIWE_URI", "http://eventclear.local")
    chain_id: int = int(os.getenv("CHAIN_ID", "31337"))
    vault_address: str = os.getenv("VAULT_ADDRESS", "0x0000000000000000000000000000000000001000")
    funding_pool_address: str = os.getenv("FUNDING_POOL_ADDRESS", "0x0000000000000000000000000000000000002000")
    collateral_token_address: str = os.getenv("COLLATERAL_TOKEN_ADDRESS", "0x0000000000000000000000000000000000003000")
    adapter_address: str = os.getenv("STANDARD_CTF_ADAPTER_ADDRESS", "0x0000000000000000000000000000000000004000")
    conditional_tokens_address: str = os.getenv(
        "CTF_ADDRESS", "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
    )
    risk_policy_address: str = os.getenv(
        "RISK_POLICY_ADDRESS", "0x0000000000000000000000000000000000005000"
    )
    relationship_registry_address: str = os.getenv(
        "RELATIONSHIP_REGISTRY_ADDRESS",
        "0x0000000000000000000000000000000000006000",
    )
    signer_key: str = os.getenv(
        "RISK_SIGNER_PRIVATE_KEY",
        "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
    )
    signer_backend: str = os.getenv("RISK_SIGNER_BACKEND", "local")
    signer_address: str = os.getenv("RISK_SIGNER_ADDRESS", "")
    signer_kms_key_id: str = os.getenv("RISK_SIGNER_KMS_KEY_ID", "")
    signer_kms_region: str = os.getenv("RISK_SIGNER_KMS_REGION", "")
    quote_lifetime_seconds: int = min(int(os.getenv("QUOTE_LIFETIME_SECONDS", "300")), 300)
    advance_ratio_bps: int = int(os.getenv("ADVANCE_RATIO_BPS", "9500"))
    origination_fee_bps: int = int(os.getenv("ORIGINATION_FEE_BPS", "50"))
    contract_manifest_path: str = os.getenv("CONTRACT_MANIFEST_PATH", "")
    gamma_api_url: str = os.getenv("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com")
    data_api_url: str = os.getenv("POLYMARKET_DATA_URL", "https://data-api.polymarket.com")
    clob_api_url: str = os.getenv("POLYMARKET_CLOB_URL", "https://clob.polymarket.com")
    market_freshness_seconds: int = int(os.getenv("MARKET_FRESHNESS_SECONDS", "30"))
    polygon_rpc_urls_raw: str = os.getenv("POLYGON_RPC_URLS", "")

    @property
    def polygon_rpc_urls(self) -> tuple[str, ...]:
        return tuple(value.strip() for value in self.polygon_rpc_urls_raw.split(",") if value.strip())

    @property
    def normalized_mode(self) -> str:
        return "production-controlled" if self.mode == "polygon-mainnet" else self.mode

    @property
    def execution_enabled(self) -> bool:
        return self.normalized_mode != "production-readonly"

    def _validate_manifest(self) -> None:
        mode = self.normalized_mode
        manifest_environment = {
            "local": "local",
            "test": "local",
            "polygon-fork": "polygon-fork",
            "staging": "local",
            "production-readonly": "polygon-mainnet",
            "production-controlled": "polygon-mainnet",
        }[mode]
        path = Path(self.contract_manifest_path or f"config/contracts/{manifest_environment}.json")
        if not path.is_file():
            raise RuntimeError("CONTRACT_MANIFEST_MISSING")
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            supplied_hash = manifest["manifestHash"]
            payload = {key: value for key, value in manifest.items() if key != "manifestHash"}
            expected_hash = "0x" + hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
            if supplied_hash != expected_hash:
                raise RuntimeError("CONTRACT_MANIFEST_HASH_MISMATCH")
            if manifest["environment"] != manifest_environment:
                raise RuntimeError("CONTRACT_MANIFEST_ENVIRONMENT_MISMATCH")
            if int(manifest["chainId"]) != self.chain_id:
                raise RuntimeError("CONTRACT_MANIFEST_CHAIN_MISMATCH")
            for entry in manifest["contracts"].values():
                address = entry["address"]
                if address == "0x" + "0" * 40 or not is_checksum_address(address):
                    raise RuntimeError("CONTRACT_MANIFEST_ADDRESS_INVALID")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise RuntimeError("CONTRACT_MANIFEST_INVALID") from exc

    def validate(self) -> None:
        if self.normalized_mode not in {
            "local",
            "test",
            "polygon-fork",
            "staging",
            "production-readonly",
            "production-controlled",
        }:
            raise RuntimeError("INVALID_OPERATING_MODE")
        if self.store_backend not in {"memory", "postgres"}:
            raise RuntimeError("INVALID_STORE_BACKEND")
        if self.signer_backend not in {"local", "kms"}:
            raise RuntimeError("INVALID_SIGNER_BACKEND")
        if not 0 < self.advance_ratio_bps <= 10_000:
            raise RuntimeError("INVALID_ADVANCE_RATIO")
        if not 0 <= self.origination_fee_bps < 10_000:
            raise RuntimeError("INVALID_ORIGINATION_FEE")
        if not 1 <= self.market_freshness_seconds <= 300:
            raise RuntimeError("INVALID_MARKET_FRESHNESS")
        if self.store_backend == "postgres" and not self.database_url:
            raise RuntimeError("DATABASE_URL_REQUIRED")
        if self.normalized_mode not in {"local", "test"} and self.store_backend != "postgres":
            raise RuntimeError("EVENTCLEAR_STORE=postgres")
        self._validate_manifest()
        if self.normalized_mode == "production-controlled":
            missing = [key for key in CONTROLLED_PRODUCTION_GATES if os.getenv(key) != "true"]
            if self.store_backend != "postgres":
                missing.append("EVENTCLEAR_STORE=postgres")
            if not self.database_url:
                missing.append("DATABASE_URL")
            if not self.redis_url:
                missing.append("REDIS_URL")
            if len(self.admin_api_token) < 32 or self.admin_api_token == "local-admin":
                missing.append("ADMIN_API_TOKEN_STRONG")
            if not self.siwe_uri.startswith("https://"):
                missing.append("SIWE_URI_HTTPS")
            if self.signer_backend != "kms":
                missing.append("RISK_SIGNER_BACKEND=kms")
            if not self.signer_address:
                missing.append("RISK_SIGNER_ADDRESS")
            if not self.signer_kms_key_id:
                missing.append("RISK_SIGNER_KMS_KEY_ID")
            if not self.signer_kms_region:
                missing.append("RISK_SIGNER_KMS_REGION")
            if missing or self.chain_id != 137:
                raise RuntimeError(f"MAINNET_SAFETY_GATE_FAILED:{','.join(missing)}")
        if self.normalized_mode == "production-readonly" and self.chain_id != 137:
            raise RuntimeError("PRODUCTION_READONLY_CHAIN_ID_MUST_BE_137")
        if self.normalized_mode in {"polygon-fork", "production-readonly", "production-controlled"}:
            if len(self.polygon_rpc_urls) < 2:
                raise RuntimeError("RPC_FAILOVER_CONFIGURED")
