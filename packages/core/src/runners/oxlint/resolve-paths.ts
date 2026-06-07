import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { OxlintUnavailable, ReactDoctorError } from "../../errors.js";

const esmRequire = createRequire(import.meta.url);

const resolveOxlintEntryPath = (): string => {
  try {
    return esmRequire.resolve("react-doctor-oxlint");
  } catch {}
  try {
    return esmRequire.resolve("oxlint");
  } catch {}
  throw new ReactDoctorError({
    reason: new OxlintUnavailable({
      kind: "binary-not-found",
      detail: "oxlint is not installed. Install it with: pnpm add -D oxlint (or npm i -D oxlint)",
    }),
  });
};

export const resolveOxlintBinary = (): string => {
  const oxlintMainPath = resolveOxlintEntryPath();
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
