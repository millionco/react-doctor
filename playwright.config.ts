import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  use: {
    channel: isCI ? "chrome" : undefined,
  },
});
