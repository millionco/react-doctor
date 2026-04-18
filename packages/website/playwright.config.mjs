import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4007",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec next build && pnpm exec next start -p 4007",
    cwd: packageRoot,
    url: "http://127.0.0.1:4007/",
    reuseExistingServer: Boolean(process.env.PW_REUSE_SERVER),
    timeout: 300_000,
  },
});
