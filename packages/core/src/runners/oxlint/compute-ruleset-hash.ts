import crypto from "node:crypto";
import type { createOxlintConfig } from "./config.js";

interface RulesetHashInput {
  /** The CACHEABLE oxlint config (cross-file rules excluded) — its resolved
   * `rules` / `categories` / `settings` are what change a cached verdict. */
  readonly config: ReturnType<typeof createOxlintConfig>;
  /** `resolveOxlintToolchainVersions()` — engine + plugin + Node versions. */
  readonly toolchainVersions: ReadonlyArray<string>;
  /** Combined ignore patterns (`collectIgnorePatterns`) — they decide whether
   * oxlint emits diagnostics for a file at all, so a change must bust the cache. */
  readonly ignorePatterns: ReadonlyArray<string>;
  /** Content of the `tsconfig` oxlint parses with (`--tsconfig`), or `null`
   * when not a TypeScript project. Folded in because it can change how oxlint
   * parses / resolves a file, so a tsconfig edit must bust the cache even when
   * source content is unchanged. */
  readonly tsconfigContent: string | null;
  /** Whether inline `// eslint-disable*` / `// oxlint-disable*` directives are
   * respected. Audit mode (`false`) neutralizes those directives on disk BEFORE
   * oxlint runs, so oxlint emits the very diagnostics they would have suppressed
   * — a different RAW stream than default mode for the same source content. It
   * therefore partitions the cache into disjoint audit / default namespaces so
   * the two modes can never replay each other's entries. (This is the ONE
   * inline-disable effect that is pre-cache; RD's own post-cache suppression of
   * `react-doctor-disable-next-line` is deliberately NOT hashed — see below.) */
  readonly respectInlineDisables: boolean;
}

const ROOT_DIRECTORY_PLACEHOLDER = "<root>";

// Strips install-location-specific absolute paths so the same ruleset hashes
// identically across machines and CI checkouts (the file keys are content
// hashes, which are already portable). `rootDirectory` and the absolute
// `jsPlugins` specifiers are the only abs paths in a cacheable config —
// neither changes a within-file rule's verdict, so both are normalized away.
const normalizeConfigForHash = (config: RulesetHashInput["config"]): unknown => {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone?.settings?.["react-doctor"]) {
    clone.settings["react-doctor"].rootDirectory = ROOT_DIRECTORY_PLACEHOLDER;
  }
  if (Array.isArray(clone?.jsPlugins)) {
    clone.jsPlugins = clone.jsPlugins.map((_: unknown, index: number) => `<plugin:${index}>`);
  }
  return clone;
};

// SHA-1 over exactly the inputs that change a cacheable rule's verdict for a
// given file content. Deliberately EXCLUDES post-oxlint presentation knobs
// (suppressions, `--no-warnings`, surface filtering, inline-disable handling,
// fix grouping) — those run on the raw diagnostic stream after the cache, so
// toggling them must not bust it.
export const computeRulesetHash = (input: RulesetHashInput): string =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(normalizeConfigForHash(input.config)))
    .update("\u0000")
    .update([...input.toolchainVersions].join("\u0000"))
    .update("\u0000")
    .update([...input.ignorePatterns].join("\n"))
    .update("\u0000")
    .update(input.tsconfigContent ?? "")
    .update("\u0000")
    .update(input.respectInlineDisables ? "respect-inline-disables" : "audit-mode")
    .digest("hex");
