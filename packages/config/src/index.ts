export type OperatingMode =
  | "local"
  | "test"
  | "polygon-fork"
  | "staging"
  | "production-readonly"
  | "production-controlled";

const requiredControlledFlags = [
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
] as const;

export function validateRuntime(env: NodeJS.ProcessEnv) {
  const requested = env.EVENTCLEAR_MODE ?? "local";
  const mode = (requested === "polygon-mainnet" ? "production-controlled" : requested) as OperatingMode;
  if (!["local", "test", "polygon-fork", "staging", "production-readonly", "production-controlled"].includes(mode)) {
    throw new Error("INVALID_OPERATING_MODE");
  }
  if (!["local", "test"].includes(mode) && env.EVENTCLEAR_STORE !== "postgres") {
    throw new Error("LIVE_MODE_REQUIRES_POSTGRES");
  }
  if (mode === "production-controlled") {
    const missing: string[] = requiredControlledFlags.filter((key) => env[key] !== "true");
    if (env.EVENTCLEAR_STORE !== "postgres") missing.push("EVENTCLEAR_STORE");
    if (env.RISK_SIGNER_BACKEND !== "kms") missing.push("RISK_SIGNER_BACKEND");
    if (missing.length) throw new Error(`MAINNET_SAFETY_GATE_FAILED:${missing.join(",")}`);
    if (env.CHAIN_ID !== "137") throw new Error("MAINNET_CHAIN_ID_MUST_BE_137");
    if (!(env.SIWE_URI ?? "").startsWith("https://")) throw new Error("MAINNET_SIWE_URI_MUST_BE_HTTPS");
    if ((env.POLYGON_RPC_URLS ?? "").split(",").filter(Boolean).length < 2) throw new Error("MAINNET_REQUIRES_RPC_FAILOVER");
  }
  const chainId = Number(env.CHAIN_ID ?? (["local", "test"].includes(mode) ? 31337 : 137));
  if (mode.startsWith("production-") && chainId !== 137) throw new Error("PRODUCTION_CHAIN_ID_MUST_BE_137");
  return { mode, chainId, executionEnabled: mode === "production-controlled" };
}
