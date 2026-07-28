#!/usr/bin/env bash
set -euo pipefail

rpc_url="${API_INTEGRATION_RPC_URL:-http://127.0.0.1:8546}"
anvil --silent --host 127.0.0.1 --port 8546 --chain-id 31337 >"${RUNNER_TEMP:-/tmp}/eventclear-anvil.log" 2>&1 &
anvil_pid=$!
trap 'kill "$anvil_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if cast chain-id --rpc-url "$rpc_url" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
cast chain-id --rpc-url "$rpc_url" >/dev/null

(
  cd packages/contracts
  forge script script/DeployLocal.s.sol:DeployLocal --rpc-url "$rpc_url" --broadcast
)

API_CONTRACT_INTEGRATION=1 API_INTEGRATION_RPC_URL="$rpc_url" \
  python -m pytest apps/api/tests/test_contract_integration.py -m contract_integration -q
