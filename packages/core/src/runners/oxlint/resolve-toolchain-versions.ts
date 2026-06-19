import { createRequire } from "node:module";

const bundledRequire = createRequire(import.meta.url);

// Packages whose version changes a cacheable rule's verdict for a given file
// content: the oxlint engine, the react-doctor rule plugin, and the optional
// React Compiler frontend. Versioned (not file-fingerprinted) so the ruleset
// hash is portable across machines / CI checkouts — a content-hashed file
// cache is only useful if the cache key survives a re-clone too.
const TOOLCHAIN_PACKAGE_SPECIFIERS = [
  "oxlint/package.json",
  "oxlint-plugin-react-doctor/package.json",
  "eslint-plugin-react-hooks/package.json",
] as const;

interface PackageVersionView {
  readonly version?: unknown;
}

// Resolved `<package>=<version>` strings (plus the active Node version) that
// feed the per-file lint cache's ruleset hash. A package that can't be
// resolved contributes a stable `missing` marker rather than throwing, so the
// hash stays deterministic.
export const resolveOxlintToolchainVersions = (): ReadonlyArray<string> => {
  const versions: string[] = [`node=${process.version}`];
  for (const specifier of TOOLCHAIN_PACKAGE_SPECIFIERS) {
    try {
      const packageJson = bundledRequire(specifier) as PackageVersionView;
      const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
      versions.push(`${specifier}=${version}`);
    } catch {
      versions.push(`${specifier}=missing`);
    }
  }
  return versions;
};
