from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    mode: str = os.getenv("EVENTCLEAR_MODE", "local")
    chain_id: int = int(os.getenv("CHAIN_ID", "31337"))
    vault_address: str = os.getenv("VAULT_ADDRESS", "0x0000000000000000000000000000000000001000")
    signer_key: str = os.getenv(
        "RISK_SIGNER_PRIVATE_KEY",
        "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
    )
    quote_lifetime_seconds: int = min(int(os.getenv("QUOTE_LIFETIME_SECONDS", "300")), 300)

    def validate(self) -> None:
        if self.mode not in {"local", "polygon-fork", "polygon-mainnet"}:
            raise RuntimeError("INVALID_OPERATING_MODE")
        if self.mode == "polygon-mainnet":
            required = (
                "ENABLE_MAINNET_EXECUTION",
                "PRODUCTION_MANIFEST_APPROVED",
                "RISK_SIGNER_CONFIGURED",
                "ADMIN_MULTISIG_CONFIGURED",
                "RPC_FAILOVER_CONFIGURED",
            )
            missing = [key for key in required if os.getenv(key) != "true"]
            if missing or self.chain_id != 137:
                raise RuntimeError(f"MAINNET_SAFETY_GATE_FAILED:{','.join(missing)}")
