import { defineConfig } from "vite-plus";

// Scope test discovery to this package's own unit tests. Without this, vitest
// also picks up the per-task hidden-test fixtures under `tasks/**/_authoring/`
// (which import seed-relative paths and only run inside a task sandbox).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tasks/**", "dist/**", "node_modules/**"],
  },
});
