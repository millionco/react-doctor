import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: ["./src/cli.ts"],
      format: ["esm"],
      clean: false,
      platform: "node",
      sourcemap: false,
      minify: process.env.NODE_ENV === "production",
      banner: { js: "#!/usr/bin/env node" },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
