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
      "packages/zed-react-doctor/**",
      "packages/react-doctor/tests/fixtures/**",
      "packages/language-server/tests/fixtures/**",
      "packages/deslop-js/tests/fixtures/**",
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
      "packages/zed-react-doctor/**",
      "packages/language-server/tests/fixtures/**",
      "packages/deslop-js/tests/fixtures/**",
    ],
  },
});
