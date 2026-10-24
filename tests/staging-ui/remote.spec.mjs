import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { assertStaging, aws } from "../../scripts/aws/common.mjs";
import { readOutputs } from "../../scripts/aws/read-staging-outputs.mjs";
import { deriveActors } from "../../scripts/aws/deploy-contracts.mjs";
const prototype=process.env.EVENTCLEAR_MODE === "testnet-prototype";
const actors=prototype ? (await import("../../scripts/prototype/environment.mjs")).stagingCompatibility() : deriveActors();
const chainId=assertStaging(), outputs=prototype ? {WebUrl:process.env.PROTOTYPE_URL,ApiUrl:process.env.PROTOTYPE_URL} : readOutputs();
const manifest=JSON.parse(readFileSync(prototype ? "config/contracts/testnet-prototype.json" : "config/contracts/staging.json","utf8"));
const runtime=prototype ? {accessToken:process.env.STAGING_ACCESS_TOKEN} : JSON.parse(aws(["secretsmanager","get-secret-value","--secret-id",outputs.RuntimeSecretArn]).SecretString);
const client = createPublicClient({
  transport: http(process.env.STAGING_RPC_PRIMARY),
});
async function setup(page, context) {
  const login = await context.request.post(outputs.WebUrl + "/staging/access", {
    form: { token: runtime.accessToken },
    maxRedirects: 0,
  });
  expect(login.status()).toBe(303);
  const config = await context.request.get(
    outputs.WebUrl + "/api/v1/config/public",
  );
  const value = await config.json();
  expect(value.mode).toBe(prototype ? "testnet-prototype" : "staging");

  expect(value.chainId).toBe(chainId);
  expect(value.mainnetExecution).toBe(false);
  // The signing key stays in the Node process. This test-only EIP-1193 bridge
  // is never part of the app build and refuses a production page or chain.
  await page.exposeBinding(
    "stagingWallet",
    async (source, { method, params = [] }) => {
      if (new URL(source.page.url()).origin !== new URL(outputs.WebUrl).origin)
        throw Error("STAGING_ORIGIN_REQUIRED");
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [actors.tester.address];
      if (method === "eth_chainId") return "0x" + chainId.toString(16);
      if (method === "personal_sign") {
        const message = params[0].startsWith("0x")
          ? Buffer.from(params[0].slice(2), "hex").toString()
          : params[0];
        if (
          !message.startsWith(
            new URL(outputs.WebUrl).host + " wants you to sign in",
          ) ||
          !message.includes(`Chain ID: ${chainId}`)
        )
          throw Error("STAGING_SIWE_REQUIRED");
        return actors.tester.signMessage({ message });
      }
      if (method === "eth_signTypedData_v4") {
        const data = JSON.parse(params[1]);
        if (
          Number(data.domain.chainId) !== chainId ||
          data.domain.verifyingContract.toLowerCase() !==
            manifest.contracts.vault.address.toLowerCase()
        )
          throw Error("STAGING_TYPED_DOMAIN_REQUIRED");
        return actors.tester.signTypedData(data);
      }
      if (["eth_call", "eth_getTransactionReceipt"].includes(method))
        return client.request({ method, params });
      // UI acceptance verifies analysis/proof/quote and final state. Onchain writes
      // are exercised by the remote lifecycle runner, with no hidden wallet bypass.
      throw Error("UI_ACCEPTANCE_UNSUPPORTED_WALLET_METHOD");
    },
  );
  await page.addInitScript(() =>
    Object.defineProperty(window, "ethereum", {
      value: { request: (args) => window.stagingWallet(args) },
    }),
  );
  await page.goto(outputs.WebUrl + "/app");
  if (prototype) await expect(page.getByRole("alert")).toContainText("TESTNET PROTOTYPE");
  await page.waitForFunction(
    () => document.documentElement.dataset.eventclearHydrated === "true",
  );
  await page.getByRole("button", { name: "Connect wallet + SIWE" }).click();
  await expect(page.getByRole("status")).toContainText("Wallet authenticated");
}
test("remote analysis proof and quote UI", async ({
  page,
  context,
  browser,
}) => {
  const anonymous = await browser.newContext();
  const denial = await anonymous.request.get(outputs.WebUrl + "/app");
  expect(denial.status()).toBe(403);
  await anonymous.close();
  await setup(page, context);
  await page.getByRole("button", { name: "Scanner" }).click();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page
    .getByRole("button", { name: "Submit exact bundle for analysis" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download proof artifact" }).click();
  expect((await download).suggestedFilename()).toContain("eventclear-proof");
  await page.getByRole("button", { name: "Verify proof artifact" }).click();
  await expect(page.getByRole("status")).toContainText(
    "reproduced successfully",
  );
  await page.getByRole("button", { name: "Request live quote" }).click();
  await expect(
    page.getByRole("button", {
      name: "Sign exact wallet authorization and continue",
    }),
  ).toBeVisible();
  mkdirSync("outputs/staging", { recursive: true });
  writeFileSync(
    "outputs/staging/ui-analysis.json",
    JSON.stringify({
      at: new Date().toISOString(),
      status: "passed",
      chainId,
      checks: [
        "barrier",
        "wallet SIWE",
        "fixture selection",
        "analysis",
        "proof download",
        "proof reproduction",
        "quote display",
      ],
    }),
  );
});
test("remote final-state UI", async ({ page, context }) => {
  await setup(page, context);
  const lifecycle = JSON.parse(
    readFileSync(prototype ? "outputs/prototype/lifecycle.json" : "outputs/staging/lifecycle.json", "utf8"),
  );
  await page.getByRole("button", { name: "Bundles" }).click();
  await expect(
    page.getByText("SETTLED", { exact: false }).first(),
  ).toBeVisible();
  const bundles = await context.request.get(outputs.ApiUrl + "/api/v1/bundles");
  const data = (await bundles.json()).data;
  expect(
    data.find((b) => String(b.onchainBundleId) === lifecycle.bundleId).status,
  ).toBe("SETTLED");
  const claims = await context.request.get(outputs.ApiUrl + "/api/v1/claims");
  const selected = (await claims.json()).data.filter(
    (c) => String(c.bundleId) === lifecycle.bundleId,
  );
  expect(selected.length).toBe(2);
  for (const c of selected) expect(BigInt(c.supplyAtomic)).toBe(0n);
  mkdirSync("outputs/staging", { recursive: true });
  writeFileSync(
    "outputs/staging/ui-final.json",
    JSON.stringify({
      at: new Date().toISOString(),
      status: "passed",
      bundleId: lifecycle.bundleId,
      checks: ["settled bundle display", "claims redeemed"],
    }),
  );
});
