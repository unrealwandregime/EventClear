import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/staging-ui",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "off", screenshot: "off", video: "off" },
});
