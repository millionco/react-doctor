import { defineConfig } from "vite-plus";
import { NODE_PACK_TARGET } from "../../scripts/build/constants.js";
import { readPackageVersion } from "../../scripts/utils/read-package-version.js";

const packageVersion = readPackageVersion(import.meta.url);

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: { neverBundle: ["oxlint-plugin-react-doctor"] },
      dts: true,
      target: NODE_PACK_TARGET,
      platform: "node",
      fixedExtension: false,
      env: {
        VERSION: process.env.VERSION ?? packageVersion,
      },
    },
  ],
});
