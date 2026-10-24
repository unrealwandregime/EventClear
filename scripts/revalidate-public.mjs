import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
const base = "https://eventclear-protocol.thecryptotom.chatgpt.site";
const get = await fetch(base + "/api/v1/config/public", {
  signal: AbortSignal.timeout(30000),
});
if (get.status !== 200) throw Error("PUBLIC_CONFIG_UNAVAILABLE");
const config = await get.json();
if (
  config.mode !== "production-readonly" ||
  config.chainId !== 137 ||
  config.mainnetExecution !== false ||
  config.publicCapitalActivated !== false
)
  throw Error("PUBLIC_READONLY_CONFIG_MISMATCH");
const serialized = JSON.stringify(config).toLowerCase();
for (const path of [
  "config/contracts/testnet-prototype.json",
  "config/contracts/staging.json",
]) {
  if (!existsSync(path)) continue;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const contract of Object.values(manifest.contracts))
    if (serialized.includes(contract.address.toLowerCase()))
      throw Error("TESTNET_ADDRESS_LEAKED_TO_PUBLIC_CONFIG");
}
if (
  process.env.PROTOTYPE_URL &&
  serialized.includes(process.env.PROTOTYPE_URL.toLowerCase())
)
  throw Error("PROTOTYPE_ENDPOINT_LEAKED_TO_PUBLIC_CONFIG");
const paths = [
  "/quotes",
  "/analysis",
  "/bundles/analyze",
  "/bundles/open/preflight",
  "/bundles/open/prepare",
  "/bundles/test-only/prepare-settlement",
  "/claims/1/prepare-redemption",
  "/pool/prepare-deposit",
  "/pool/prepare-withdrawal",
  "/admin/relationships",
  "/auth/siwe/nonce",
];
for (const path of paths) {
  const response = await fetch(base + "/api/v1" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30000),
  });
  if (
    response.status !== 403 ||
    !(await response.text()).includes("PRODUCTION_READONLY")
  )
    throw Error("PUBLIC_WRITE_ROUTE_NOT_READONLY");
}
const output =
  process.env.EVENTCLEAR_MODE === "testnet-prototype"
    ? "outputs/prototype"
    : "outputs/staging";
mkdirSync(output, { recursive: true });
writeFileSync(
  output + "/public-isolation.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: "passed",
      mode: "production-readonly",
      chainId: 137,
      mainnetExecution: false,
      publicCapitalActivated: false,
      writeRoutesChecked: paths.length,
    },
    null,
    2,
  ) + "\n",
);
