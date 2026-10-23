import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "https://eventclear-protocol.thecryptotom.chatgpt.site";
const get = await fetch(base + "/api/v1/config/public");
assert.equal(get.status, 200);
const config = await get.json();
assert.equal(config.mainnetExecution, false);
assert.equal(config.publicCapitalActivated, false);
for (const path of [
  "/quotes",
  "/bundles/analyze",
  "/bundles/open/preflight",
  "/bundles/open/prepare",
  "/pool/prepare-deposit",
]) {
  const response = await fetch(base + "/api/v1" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /PRODUCTION_READONLY/);
}
mkdirSync("outputs/staging", { recursive: true });
writeFileSync(
  "outputs/staging/public-isolation.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: "passed",
      mainnetExecution: false,
      publicCapitalActivated: false,
    },
    null,
    2,
  ),
);
