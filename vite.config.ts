import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{js,ts,tsx}": "vp check --fix",
    "*.{json,jsonc,json5,yaml,yml,toml,html,css,scss,less,md,mdx,graphql,gql}": "vp fmt",
  },
  lint: {
    ignorePatterns: [
      ".turbo",
      "dist",
      "build",
      "node_modules",
      "packages/core/tests/fixtures/**",
      "packages/react-doctor/tests/fixtures/**",
      "packages/fuzz/corpus/react-bench-0.9.7-audit/**",
    ],
    plugins: ["typescript", "react", "import"],
    rules: {},
  },
  fmt: {
    semi: true,
    singleQuote: false,
    ignorePatterns: [
      ".turbo",
      "node_modules",
      "dist",
      "build",
      "pnpm-lock.yaml",
      "packages/fuzz/corpus/react-bench-0.9.7-audit*",
    ],
  },
});
