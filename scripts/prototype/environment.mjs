import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export function assertPrototype(env = process.env) {
  if (
    env.EVENTCLEAR_MODE !== "testnet-prototype" ||
    ![80002, 11155111].includes(Number(env.CHAIN_ID)) ||
    env.TESTNET_ASSETS_ONLY !== "true" ||
    env.ENABLE_MAINNET_EXECUTION !== "false" ||
    env.PUBLIC_CAPITAL_ACTIVATED !== "false" ||
    env.PROTOTYPE_MAX_MONTHLY_COST_USD !== "0"
  )
    throw Error("PROTOTYPE_SAFETY_GATE_FAILED");
  return Number(env.CHAIN_ID);
}
export function actors(env = process.env) {
  assertPrototype(env);
  const dev = new Set(
    Array.from({ length: 20 }, (_, addressIndex) =>
      mnemonicToAccount(
        "test test test test test test test test test test test junk",
        { addressIndex },
      ).address.toLowerCase(),
    ),
  );
  dev.add(
    privateKeyToAccount(
      "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
    ).address.toLowerCase(),
  );
  const result = {};
  for (const [role, keyName] of [
    ["deployer", "PROTOTYPE_DEPLOYER_PRIVATE_KEY"],
    ["lp", "PROTOTYPE_LP_PRIVATE_KEY"],
    ["tester", "PROTOTYPE_TESTER_PRIVATE_KEY"],
    ["risk", "RISK_SIGNER_PRIVATE_KEY"],
  ]) {
    if (!/^0x[0-9a-f]{64}$/i.test(env[keyName] ?? ""))
      throw Error(`DEDICATED_KEY_REQUIRED:${role}`);
    const account = privateKeyToAccount(env[keyName]);
    if (dev.has(account.address.toLowerCase()))
      throw Error(`DEVELOPMENT_KEY_PROHIBITED:${role}`);
    const pin =
      role === "risk"
        ? "RISK_SIGNER_ADDRESS"
        : `PROTOTYPE_${role.toUpperCase()}_ADDRESS`;
    if (env[pin] && env[pin].toLowerCase() !== account.address.toLowerCase())
      throw Error(`ACTOR_PIN_MISMATCH:${role}`);
    env[pin] = account.address;
    result[role] = account;
  }
  const admin = env.PROTOTYPE_ADMIN_ADDRESS;
  if (
    !/^0x[0-9a-f]{40}$/i.test(admin ?? "") ||
    dev.has(admin.toLowerCase()) ||
    new Set([
      ...Object.values(result).map((a) => a.address.toLowerCase()),
      admin.toLowerCase(),
    ]).size !== 5
  )
    throw Error("SEPARATE_DEDICATED_ADMIN_REQUIRED");
  return result;
}
export function manifest(path = "config/contracts/testnet-prototype.json") {
  const value = JSON.parse(readFileSync(path, "utf8"));
  const { manifestHash, ...payload } = value;
  if (
    value.environment !== "testnet-prototype" ||
    value.chainId !== assertPrototype() ||
    manifestHash !==
      "0x" + createHash("sha256").update(canonical(payload)).digest("hex")
  )
    throw Error("PROTOTYPE_MANIFEST_INVALID");
  return value;
}
export function stagingCompatibility(env = process.env) {
  assertPrototype(env);
  const a = actors(env);
  Object.assign(env, {
    STAGING_CHAIN_ID: env.CHAIN_ID,
    STAGING_TEST_ASSETS_ONLY: "true",
    STAGING_RPC_PRIMARY: env.RPC_PRIMARY,
    STAGING_RPC_FALLBACK: env.RPC_FALLBACK || "",
    STAGING_DEPLOYER_PRIVATE_KEY: env.PROTOTYPE_DEPLOYER_PRIVATE_KEY,
    STAGING_LP_PRIVATE_KEY: env.PROTOTYPE_LP_PRIVATE_KEY,
    STAGING_TEST_EOA_PRIVATE_KEY: env.PROTOTYPE_TESTER_PRIVATE_KEY,
    STAGING_ADMIN_ADDRESS: env.PROTOTYPE_ADMIN_ADDRESS,
    STAGING_DEPLOYER_ADDRESS: a.deployer.address,
    STAGING_LP_ADDRESS: a.lp.address,
    STAGING_TEST_EOA: a.tester.address,
  });
  return { deployer: a.deployer, lp: a.lp, tester: a.tester };
}
function fail(error) {
  const message = String(error?.message ?? "");
  console.error(
    /^[A-Z0-9_:=-]{1,160}$/.test(message)
      ? message
      : "PROTOTYPE_OPERATION_FAILED_CHECK_CONFIGURATION",
  );
  process.exit(1);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
