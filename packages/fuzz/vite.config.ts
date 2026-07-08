import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Corpus checkouts under tmp/ carry their own *.spec.ts / *.test.ts
    // files; without this include they'd be globbed into our run.
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
