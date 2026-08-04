import { defineConfig } from "@playwright/test";
import { PROVER_RUNTIME_ORACLE_PORT, PROVER_RUNTIME_ORACLE_TIMEOUT_MS } from "./src/constants.js";

const baseUrl = `http://127.0.0.1:${PROVER_RUNTIME_ORACLE_PORT}`;

export default defineConfig({
  testDir: "tests/runtime",
  timeout: PROVER_RUNTIME_ORACLE_TIMEOUT_MS,
  use: {
    baseURL: baseUrl,
  },
  webServer: {
    command: `vite --config tests/runtime/vite.config.ts --host 127.0.0.1 --port ${PROVER_RUNTIME_ORACLE_PORT} --strictPort`,
    url: baseUrl,
    reuseExistingServer: false,
    timeout: PROVER_RUNTIME_ORACLE_TIMEOUT_MS,
  },
});
