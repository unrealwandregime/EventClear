"""Fail when a Python RPC contract call is absent from the compiled ABI."""

from __future__ import annotations

import ast
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "packages" / "contracts"
API_SOURCE = ROOT / "apps" / "api" / "src"

TARGET_ARTIFACTS = {
    "adapter_address": "MockCTFAdapter.sol/MockCTFAdapter.json",
    "collateral_token_address": "MockPUSD.sol/MockPUSD.json",
    "conditional_tokens_address": "MockConditionalTokens.sol/MockConditionalTokens.json",
    "funding_pool_address": "EventClearFundingPool.sol/EventClearFundingPool.json",
    "relationship_registry_address": "RelationshipRegistry.sol/RelationshipRegistry.json",
    "risk_policy_address": "RiskPolicy.sol/RiskPolicy.json",
    "vault_address": "EventClearVault.sol/EventClearVault.json",
}


@dataclass(frozen=True)
class ContractCall:
    source: Path
    line: int
    target: str
    signature: str
    call_kind: str


def _abi_type(item: dict) -> str:
    raw_type = item["type"]
    if not raw_type.startswith("tuple"):
        return raw_type
    suffix = raw_type.removeprefix("tuple")
    components = ",".join(_abi_type(component) for component in item["components"])
    return f"({components}){suffix}"


def _signature(entry: dict) -> str:
    parameters = ",".join(_abi_type(item) for item in entry.get("inputs", []))
    return f"{entry['name']}({parameters})"


def _constant_sequences(tree: ast.AST) -> dict[str, tuple[str, ...]]:
    result: dict[str, tuple[str, ...]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        target = node.targets[0] if isinstance(node, ast.Assign) else node.target
        value = node.value
        if not isinstance(target, ast.Name) or not isinstance(
            value, (ast.Tuple, ast.List)
        ):
            continue
        values = tuple(
            item.value
            for item in value.elts
            if isinstance(item, ast.Constant) and isinstance(item.value, str)
        )
        if len(values) == len(value.elts):
            result[target.id] = values
    return result


def _target_name(node: ast.AST) -> str | None:
    if (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "settings"
    ):
        return node.attr
    return None


def _signatures(
    node: ast.AST, sequences: dict[str, tuple[str, ...]], target: str | None
) -> tuple[str, ...]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return (node.value,)
    if isinstance(node, ast.JoinedStr):
        formatted = [
            item for item in node.values if isinstance(item, ast.FormattedValue)
        ]
        literal = "".join(
            str(item.value) for item in node.values if isinstance(item, ast.Constant)
        )
        if (
            len(formatted) == 1
            and isinstance(formatted[0].value, ast.Name)
            and literal == "()"
        ):
            names = sequences.get(formatted[0].value.id)
            if names is None:
                sequence_name = {
                    "funding_pool_address": "pool_names",
                    "risk_policy_address": "risk_names",
                }.get(target or "")
                names = sequences.get(sequence_name or "", ())
            return tuple(f"{name}()" for name in names)
    return ()


def collect_calls() -> list[ContractCall]:
    calls: list[ContractCall] = []
    for source in API_SOURCE.rglob("*.py"):
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
        sequences = _constant_sequences(tree)
        for node in ast.walk(tree):
            if (
                not isinstance(node, ast.Call)
                or not isinstance(node.func, ast.Attribute)
                or node.func.attr not in {"contract_call", "contract_call_words"}
                or len(node.args) < 2
            ):
                continue
            target = _target_name(node.args[0])
            signatures = _signatures(node.args[1], sequences, target)
            if target is None or not signatures:
                raise RuntimeError(
                    f"{source.relative_to(ROOT)}:{node.lineno}: contract call target/signature "
                    "must be statically verifiable"
                )
            calls.extend(
                ContractCall(
                    source=source,
                    line=node.lineno,
                    target=target,
                    signature=signature,
                    call_kind=node.func.attr,
                )
                for signature in signatures
            )
    return calls


CALLDATA_TARGETS = {
    "redeem_claim": "vault_address",
    "deposit": "funding_pool_address",
    "withdraw": "funding_pool_address",
    "set_approval_for_all": "conditional_tokens_address",
    "settle_bundle": "vault_address",
    "open_bundle": "vault_address",
}


def _string_values(
    node: ast.AST, constants: dict[str, tuple[str, ...]]
) -> tuple[str, ...]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return (node.value,)
    if isinstance(node, ast.Name):
        return constants.get(node.id, ())
    if isinstance(node, ast.JoinedStr):
        values = [""]
        for item in node.values:
            if isinstance(item, ast.Constant):
                fragments = (str(item.value),)
            elif isinstance(item, ast.FormattedValue):
                fragments = _string_values(item.value, constants)
            else:
                fragments = ()
            values = [prefix + fragment for prefix in values for fragment in fragments]
        return tuple(values)
    return ()


def collect_calldata_calls() -> list[ContractCall]:
    source = API_SOURCE / "eventclear_api" / "calldata.py"
    tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    constants = _constant_sequences(tree)
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            values = _string_values(node.value, constants)
            if values:
                constants[node.targets[0].id] = values

    calls: list[ContractCall] = []
    for function in (node for node in tree.body if isinstance(node, ast.FunctionDef)):
        target = CALLDATA_TARGETS.get(function.name)
        if target is None:
            continue
        local = dict(constants)
        for node in ast.walk(function):
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                values = _string_values(node.value, local)
                if values:
                    local[node.targets[0].id] = tuple(
                        dict.fromkeys((*local.get(node.targets[0].id, ()), *values))
                    )
        for node in ast.walk(function):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "encode_call"
                and node.args
            ):
                signatures = _string_values(node.args[0], local)
                if not signatures:
                    raise RuntimeError(
                        f"{source.relative_to(ROOT)}:{node.lineno}: calldata signature "
                        "must be statically verifiable"
                    )
                calls.extend(
                    ContractCall(
                        source=source,
                        line=node.lineno,
                        target=target,
                        signature=signature,
                        call_kind="encode_call",
                    )
                    for signature in signatures
                )
    return calls


def main() -> None:
    subprocess.run(["forge", "build"], cwd=CONTRACTS, check=True)
    compiled: dict[str, dict[str, list[dict]]] = {}
    for target, artifact_path in TARGET_ARTIFACTS.items():
        artifact = json.loads(
            (CONTRACTS / "out" / artifact_path).read_text(encoding="utf-8")
        )
        compiled[target] = {
            _signature(entry): entry.get("outputs", [])
            for entry in artifact["abi"]
            if entry.get("type") == "function"
        }

    calls = [*collect_calls(), *collect_calldata_calls()]
    errors: list[str] = []
    for call in calls:
        functions = compiled.get(call.target)
        location = f"{call.source.relative_to(ROOT)}:{call.line}"
        if functions is None:
            errors.append(f"{location}: no ABI mapping for settings.{call.target}")
            continue
        outputs = functions.get(call.signature)
        if outputs is None:
            errors.append(
                f"{location}: {call.signature} is absent from the compiled "
                f"{TARGET_ARTIFACTS[call.target]}"
            )
            continue
        if call.call_kind == "contract_call_words" and len(outputs) < 2:
            errors.append(
                f"{location}: contract_call_words requires a multi-word ABI result"
            )
        if call.call_kind == "contract_call" and len(outputs) != 1:
            errors.append(
                f"{location}: contract_call expects exactly one ABI output; "
                f"{call.signature} has {len(outputs)}"
            )

    if errors:
        raise SystemExit(
            "API ABI compatibility check failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )
    print(f"API ABI compatibility check passed ({len(calls)} compiled calls).")


if __name__ == "__main__":
    main()
