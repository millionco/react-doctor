import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { TSCONFIG_FILENAMES } from "../../constants.js";

const esmRequire = createRequire(import.meta.url);

export const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

// Oxlint loads JS plugins by file path (`await import(specifier)`). We
// resolve the installed `oxlint-plugin-react-doctor` package's main
// entry — it ships a default-exported plugin module that oxlint
// accepts as-is. Works in dev (workspace symlink), in npm installs
// (node_modules/.pnpm/...), and from pnpm dlx / npx temp directories.
export const resolvePluginPath = (): string => esmRequire.resolve("oxlint-plugin-react-doctor");

export const resolveTsConfigRelativePath = (rootDirectory: string): string | null => {
  for (const filename of TSCONFIG_FILENAMES) {
    if (fs.existsSync(path.join(rootDirectory, filename))) {
      return `./${filename}`;
    }
  }
  return null;
};
