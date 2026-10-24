import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { assertStaging, isMain } from "./common.mjs";
const devAddresses = new Set(
  Array.from({ length: 20 }, (_, addressIndex) =>
    mnemonicToAccount(
      "test test test test test test test test test test test junk",
      { addressIndex },
    ).address.toLowerCase(),
  ),
);
devAddresses.add(
  privateKeyToAccount(
    "0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d",
  ).address.toLowerCase(),
);
export function validateSigners(env = process.env) {
  assertStaging(env);
  const actors = {};
  for (const [role, keyName, addressName] of [
    ["deployer", "STAGING_DEPLOYER_PRIVATE_KEY", "STAGING_DEPLOYER_ADDRESS"],
    ["lp", "STAGING_LP_PRIVATE_KEY", "STAGING_LP_ADDRESS"],
    ["tester", "STAGING_TEST_EOA_PRIVATE_KEY", "STAGING_TEST_EOA"],
  ]) {
    const key = env[keyName];
    if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? ""))
      throw Error(`STAGING_KEY_REQUIRED:${role}`);
    const account = privateKeyToAccount(key);
    if (devAddresses.has(account.address.toLowerCase()))
      throw Error(`KNOWN_DEVELOPMENT_KEY_PROHIBITED:${role}`);
    if (!env[addressName] || getAddress(env[addressName]) !== account.address)
      throw Error(`STAGING_ADDRESS_MISMATCH:${role}`);
    actors[role] = account;
  }
  if (new Set(Object.values(actors).map((a) => a.address)).size !== 3)
    throw Error("SEPARATE_STAGING_SIGNERS_REQUIRED");
  return actors;
}
if (isMain(import.meta.url))
  console.log(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(validateSigners()).map(([k, a]) => [k, a.address]),
      ),
    ),
  );
