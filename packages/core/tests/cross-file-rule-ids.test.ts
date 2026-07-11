import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  CROSS_FILE_DEPENDENCY_COLLECTORS,
  CROSS_FILE_RULE_IDS,
  UNBOUNDED_CROSS_FILE_RULE_IDS,
} from "oxlint-plugin-react-doctor";

// The staleness safety net. Reproduces the transitive import-graph analysis
// that classifies a rule as cross-file (its verdict can depend on the content
// of OTHER files at lint time) and asserts the detected set EQUALS
// `CROSS_FILE_RULE_IDS`. If a new rule starts reading other files without being
// added to that set, the per-file lint cache would serve it stale results — and
// this test fails instead.
//
// Lives in @react-doctor/core (not the plugin package) on purpose: CI's root
// `pnpm test` filter skips the plugin's own suite, so a guard there would never
// run. Core IS in that filter, and it already depends on the plugin, so it
// reads the plugin's rule source over the workspace layout.

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SOURCE_DIRECTORY = path.resolve(
  TEST_DIRECTORY,
  "../../oxlint-plugin-react-doctor/src/plugin",
);
const RULES_DIRECTORY = path.join(PLUGIN_SOURCE_DIRECTORY, "rules");

// Primitives that read the content / existence of files OTHER than the one
// being linted. A rule reaching any of these is cross-file. Project-config
// readers (tsconfig) are included because resolving an alias walks to a real
// source file via `resolve-relative-import-path`; `read-nearest-package-manifest`
// (package.json — reached through `classify-package-platform` and the
// bundle-size package predicates) is the lone config-only reader, kept here
// so the rules reaching it (`rn-prefer-expo-image`, `no-full-lodash-import`,
// …) are detected.
const CROSS_FILE_PRIMITIVE_FILES = [
  "utils/parse-source-file.ts",
  "utils/does-module-export-name.ts",
  "utils/has-ancestor-layout-matching.ts",
  "utils/resolve-cross-file-function-export.ts",
  "utils/resolve-relative-import-path.ts",
  "utils/resolve-module-path.ts",
  "utils/resolve-barrel-export-file-path.ts",
  "utils/find-ancestor-suspense-layout.ts",
  "utils/find-ancestor-metadata-layout.ts",
  "utils/is-barrel-index-module.ts",
  "utils/read-nearest-package-manifest.ts",
].map((relativePath) => path.resolve(PLUGIN_SOURCE_DIRECTORY, relativePath));
const primitiveFileSet = new Set(CROSS_FILE_PRIMITIVE_FILES);

// Strip comments + string literals so a `readFileSync` mentioned in a comment
// or regex doesn't read as a real import target.
const stripCommentsAndStrings = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const resolveLocalImport = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.js$/, "");
  for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const localImportsOf = (filePath: string): string[] => {
  const source = stripCommentsAndStrings(fs.readFileSync(filePath, "utf8"));
  const matches = source.matchAll(/(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g);
  return [...matches]
    .map((match) => resolveLocalImport(filePath, match[1]))
    .filter((resolved): resolved is string => resolved !== null);
};

const reachCache = new Map<string, boolean>();
const reachesCrossFilePrimitive = (filePath: string, seen = new Set<string>()): boolean => {
  const cached = reachCache.get(filePath);
  if (cached !== undefined) return cached;
  if (seen.has(filePath)) return false;
  seen.add(filePath);
  let result = primitiveFileSet.has(filePath);
  if (!result) {
    for (const imported of localImportsOf(filePath)) {
      if (reachesCrossFilePrimitive(imported, seen)) {
        result = true;
        break;
      }
    }
  }
  reachCache.set(filePath, result);
  return result;
};

const collectRuleFiles = (directory: string): string[] => {
  const ruleFiles: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // `utils/` subtrees hold helpers, not rule definitions.
        if (entry.name !== "utils") walk(entryPath);
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.includes(".test.") &&
        entry.name !== "index.ts"
      ) {
        ruleFiles.push(entryPath);
      }
    }
  };
  walk(directory);
  return ruleFiles;
};

const detectCrossFileRuleIds = (): Set<string> => {
  const detected = new Set<string>();
  for (const ruleFile of collectRuleFiles(RULES_DIRECTORY)) {
    const source = fs.readFileSync(ruleFile, "utf8");
    const ruleId = source.match(/\bid:\s*["']([^"']+)["']/)?.[1];
    if (ruleId === undefined) continue;
    // Scan rules run via core's check-security-scan, never the oxlint config,
    // so they're irrelevant to the lint cache even if they read other files.
    if (/\bscan:\s*(?:\(|async)/.test(stripCommentsAndStrings(source))) continue;
    if (reachesCrossFilePrimitive(path.resolve(ruleFile))) detected.add(ruleId);
  }
  return detected;
};

describe("CROSS_FILE_RULE_IDS", () => {
  it("exactly matches the rules that transitively read other files at lint time", () => {
    const detected = [...detectCrossFileRuleIds()].sort();
    const declared = [...CROSS_FILE_RULE_IDS].sort();
    expect(detected).toEqual(declared);
  });

  it("contains the verified set and nothing the analysis can't justify", () => {
    expect([...CROSS_FILE_RULE_IDS].sort()).toEqual([
      "nextjs-missing-metadata",
      "nextjs-no-use-search-params-without-suspense",
      "no-barrel-import",
      "no-dynamic-import-path",
      "no-full-lodash-import",
      "no-hydration-branch-on-browser-global",
      "no-indeterminate-attribute",
      "no-locale-format-in-render",
      "no-match-media-in-state-initializer",
      "no-mutating-reducer-state",
      "no-unguarded-browser-global-in-render-or-hook-init",
      "prefer-dynamic-import",
      "rendering-hydration-mismatch-time",
      "rn-no-legacy-shadow-styles",
      "rn-no-raw-text",
      "rn-prefer-expo-image",
      "rn-style-prefer-boxshadow",
    ]);
  });

  // The sidecar lint cache's classification guard: every cross-file rule must
  // be CONSCIOUSLY classified as either fingerprint-BOUNDED (it ships a
  // dependency collector, so its diagnostics can replay from the sidecar
  // cache) or UNBOUNDED (no sound dependency bound exists — it re-lints every
  // file on every scan). A new cross-file rule fails here until its author
  // adds it to one side in the plugin's `cross-file-dependencies.ts`.
  it("classifies every cross-file rule as bounded (collector) or unbounded — exactly one", () => {
    const collectorRuleIds = [...CROSS_FILE_DEPENDENCY_COLLECTORS.keys()];
    const overlappingRuleIds = collectorRuleIds.filter((ruleId) =>
      UNBOUNDED_CROSS_FILE_RULE_IDS.has(ruleId),
    );
    expect(overlappingRuleIds).toEqual([]);
    expect([...collectorRuleIds, ...UNBOUNDED_CROSS_FILE_RULE_IDS].sort()).toEqual(
      [...CROSS_FILE_RULE_IDS].sort(),
    );
  });
});
