import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  test: {
    server: {
      deps: {
        external: [],
      },
    },
  },
  plugins: [
    {
      name: "react-doctor-eslint-native-run-dependency",
      configureVitest: ({ project, vitest }) => {
        if (vitest.config.watch) return;
        const externalDependencies = project.config.server?.deps?.external;
        if (!externalDependencies) throw new Error("ESLint dependency configuration is missing");
        // HACK: VitePlus 0.1.20 captures this array before the hook; mutate it in place.
        externalDependencies.push(/[\\/]oxlint-plugin-react-doctor[\\/]dist[\\/]/);
      },
    },
  ],
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: { neverBundle: ["oxlint-plugin-react-doctor"] },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
      env: {
        VERSION: process.env.VERSION ?? packageJson.version,
      },
    },
  ],
});
