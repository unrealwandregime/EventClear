export type OperatingMode = "local" | "polygon-fork" | "polygon-mainnet";

const requiredMainnetFlags = [
  "ENABLE_MAINNET_EXECUTION",
  "PRODUCTION_MANIFEST_APPROVED",
  "RISK_SIGNER_CONFIGURED",
  "ADMIN_MULTISIG_CONFIGURED",
  "RPC_FAILOVER_CONFIGURED",
] as const;

export function validateRuntime(env: NodeJS.ProcessEnv) {
  const mode = (env.EVENTCLEAR_MODE ?? "local") as OperatingMode;
  if (!["local", "polygon-fork", "polygon-mainnet"].includes(mode)) throw new Error("INVALID_OPERATING_MODE");
  if (mode === "polygon-mainnet") {
    const missing = requiredMainnetFlags.filter((key) => env[key] !== "true");
    if (missing.length) throw new Error(`MAINNET_SAFETY_GATE_FAILED:${missing.join(",")}`);
    if (env.CHAIN_ID !== "137") throw new Error("MAINNET_CHAIN_ID_MUST_BE_137");
  }
  return { mode, chainId: Number(env.CHAIN_ID ?? (mode === "local" ? 31337 : 137)) };
}
