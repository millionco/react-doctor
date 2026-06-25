import { defineConfig } from "vite";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/core.ts", "src/utils.ts"],
    },
  },
});
