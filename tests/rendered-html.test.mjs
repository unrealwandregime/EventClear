import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/", init = { headers: { accept: "text/html" } }) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders EventClear product content", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>EventClear/);
  assert.match(html, /Unlock guaranteed value before markets resolve/);
  assert.match(html, /Public read-only alpha/);
  assert.match(html, /Live Polymarket market and position data are available/);
  assert.match(html, /public capital execution disabled/);
  assert.doesNotMatch(html, /Mainnet candidate|Mainnet release candidate/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("public deployment rejects every execution endpoint", async () => {
  const paths = [
    "/api/v1/quotes",
    "/api/v1/bundles/analyze",
    "/api/v1/bundles/open/preflight",
    "/api/v1/bundles/open/prepare",
    "/api/v1/bundles/1/prepare-settlement",
    "/api/v1/claims/1/prepare-redemption",
    "/api/v1/pool/prepare-deposit",
    "/api/v1/pool/prepare-withdrawal",
    "/api/v1/quotes/q1/refresh",
  ];
  for (const path of paths) {
    const response = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).detail.code, "PRODUCTION_READONLY", path);
  }
});
