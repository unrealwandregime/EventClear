"""Verify the configured test chain and deployed signer before accepting traffic."""

import asyncio
import json
from pathlib import Path
from eventclear_api.settings import Settings
from eventclear_api.staging import StagingGateway, load_fixture


async def preflight():
    settings = Settings()
    settings.validate()
    fixture = load_fixture(settings)
    manifest = json.loads(Path(settings.contract_manifest_path).read_text())
    gateway = StagingGateway(settings, fixture)
    for url in settings.polygon_rpc_urls:
        gateway.rpc_urls = (url,)
        if int(await gateway.rpc("eth_chainId", []), 16) != settings.chain_id:
            raise RuntimeError("RPC_CHAIN_MISMATCH")
        for contract in manifest["contracts"].values():
            code = await gateway.rpc("eth_getCode", [contract["address"], "latest"])
            if not code or code == "0x":
                raise RuntimeError("DEPLOYED_CODE_REQUIRED")
        signer = await gateway.contract_call(
            settings.risk_policy_address, "quoteSigner()"
        )
        if signer != int(settings.signer_address, 16):
            raise RuntimeError("ONCHAIN_SIGNER_MISMATCH")


if __name__ == "__main__":
    asyncio.run(preflight())
