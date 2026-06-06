import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const esmRequire = createRequire(import.meta.url);

export class OxlintNotInstalledError extends Error {
  constructor() {
    super(
      `oxlint is not installed. Install it as a dependency:\n\n` +
        `  npm install -D oxlint\n` +
        `  # or: pnpm add -D oxlint\n` +
        `  # or: yarn add -D oxlint\n\n` +
        `In pnpm monorepos using vite-plus/vitest, install oxlint at the workspace root ` +
        `to avoid duplicate module instances. See: https://github.com/millionco/react-doctor/issues`,
    );
    this.name = "OxlintNotInstalledError";
  }
}

export const resolveOxlintBinary = (): string => {
  let oxlintMainPath: string;
  try {
    oxlintMainPath = esmRequire.resolve("oxlint");
  } catch {
    throw new OxlintNotInstalledError();
  }
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

// Oxlint loads JS plugins by file path (`await import(specifier)`). We
// resolve the installed `oxlint-plugin-react-doctor` package's main
// entry — it ships a default-exported plugin module that oxlint
// accepts as-is. Works in dev (workspace symlink), in npm installs
// (node_modules/.pnpm/...), and from pnpm dlx / npx temp directories.
export const resolvePluginPath = (): string => esmRequire.resolve("oxlint-plugin-react-doctor");

const TSCONFIG_FILENAMES = ["tsconfig.json", "tsconfig.base.json"];

export const resolveTsConfigRelativePath = (rootDirectory: string): string | null => {
  for (const filename of TSCONFIG_FILENAMES) {
    if (fs.existsSync(path.join(rootDirectory, filename))) {
      return `./${filename}`;
    }
  }
  return null;
};
