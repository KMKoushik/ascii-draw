import { defineConfig } from "@playwright/test";
import { randomInt } from "node:crypto";

// Locally, CF-Connecting-IP passes through; a fresh value per run gives each run its own rate-limit bucket.
const clientIp = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: { baseURL: "http://localhost:8787", viewport: { width: 1440, height: 1050 }, extraHTTPHeaders: { "CF-Connecting-IP": clientIp } },
  webServer: {
    command: "npx wrangler dev --port 8787 --local-upstream localhost:8787",
    url: "http://localhost:8787",
    reuseExistingServer: !process.env.CI,
    env: { PUBLISH_API_KEY: "local-test-key-not-for-production" },
  },
});
