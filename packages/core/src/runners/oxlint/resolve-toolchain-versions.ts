import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { NODE_VERSION_PROBE_TIMEOUT_MS } from "../../constants.js";

const bundledRequire = createRequire(import.meta.url);

const childNodeVersionByBinaryPath = new Map<string, string>();

// The plugin rules execute as JS inside the oxlint CHILD, which can run a
// different Node than this process (the nvm fallback in
// `resolveNodeForOxlint`) — so the cache-busting engine version must be the
// child's, not the parent's. Probed once per binary per process; a failed
// probe contributes a stable marker so the hash stays deterministic (and
// conservative: distinct markers for distinct binaries still bust the cache).
const resolveChildNodeVersion = (nodeBinaryPath: string): string => {
  if (nodeBinaryPath === process.execPath) return process.version;
  const cachedVersion = childNodeVersionByBinaryPath.get(nodeBinaryPath);
  if (cachedVersion !== undefined) return cachedVersion;
  let version: string;
  try {
    version = execFileSync(nodeBinaryPath, ["--version"], {
      encoding: "utf8",
      timeout: NODE_VERSION_PROBE_TIMEOUT_MS,
    }).trim();
  } catch {
    version = `unknown:${nodeBinaryPath}`;
  }
  childNodeVersionByBinaryPath.set(nodeBinaryPath, version);
  return version;
};

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

// Resolved `<package>=<version>` strings (plus the Node version the oxlint
// child will actually run under) that feed the per-file lint cache's ruleset
// hash. A package that can't be resolved contributes a stable `missing`
// marker rather than throwing, so the hash stays deterministic.
export const resolveOxlintToolchainVersions = (
  nodeBinaryPath: string = process.execPath,
): ReadonlyArray<string> => {
  const versions: string[] = [`node=${resolveChildNodeVersion(nodeBinaryPath)}`];
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
