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

test("server-renders the investor-facing EventClear product story", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>EventClear/);
  assert.match(html, /Unlock guaranteed value before prediction markets resolve/);
  assert.match(html, /Live research release/);
  assert.match(html, /Guaranteed terminal payout/);
  assert.match(html, /Target round/);
  assert.match(html, /Independent audit and controlled pilot are pending/);
  assert.doesNotMatch(html, /API_405/);
  assert.doesNotMatch(html, />Unavailable</);
  assert.doesNotMatch(html, /No verified active bundle/);
  assert.doesNotMatch(html, /Mainnet candidate|Mainnet release candidate/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the separate protocol application", async () => {
  const response = await request("/app");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Live Polymarket market and position data are available/);
  assert.match(html, /Capital pilot · pre-launch/);
});

test("public claims state is readable without producing an API 405", async () => {
  const response = await request("/api/v1/claims");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [], source: "indexed", chainId: 137 });
});

test("public discovery metadata is available to crawlers", async () => {
  const robots = await request("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Allow: \//);
  const sitemap = await request("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /eventclear-protocol\.thecryptotom\.chatgpt\.site/);
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
