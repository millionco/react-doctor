// The incremental analysis cache behind `DeslopConfig.incrementalCachePath`.
// One tree walk per run is the single change detector; from it four layers are
// validated independently:
//   1. per-file parse summaries (`ParsedSource`) keyed by (mtimeMs, size);
//   2. the collected file LIST keyed by `collectHash` (sorted file names, with
//      manifest-like files stat-fingerprinted). Entry RESOLUTION is
//      deliberately NOT cached: `resolveEntries` reads an unbounded content
//      set (bundler/test-runner config strings, workflow yml, HTML, tsconfig
//      contents, even sibling-workspace sources), so no name-based fingerprint
//      can validate it — it re-runs live every scan, overlapped with parsing;
//   3. the `fromDir::specifier → ResolvedImport` map keyed by `resolutionHash`
//      (`collectHash` ⊕ bundler-config stats — module resolution depends on the
//      file SET, so summaries cache raw specifiers only and any add/delete/
//      rename drops the whole resolution map);
//   4. per-file package-reference facts for `detectStalePackages`' content
//      scans, keyed by (mtimeMs, size, queried-name-set hash).
// Every read fails open (corrupt / missing / version- or scope-mismatched data
// degrades to a fresh computation, never a wrong result), saves are atomic
// (temp file + rename) and skipped when nothing changed. The accepted blind
// spot, shared with the stat-based caches in @react-doctor/core: an edit that
// preserves both a file's mtime and its byte size is invisible. The walk is
// rooted at `rootDir` (matching core's whole-result dead-code cache), so
// manifest edits ABOVE the scanned root share that cache's accepted gap.
import crypto from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Minimatch } from "minimatch";
import type { DeslopConfig, SourceFile } from "./types.js";
import type { ParsedSource } from "./collect/parse.js";
import type { ResolvedImport } from "./resolver/resolve.js";
import { DeslopError, type DeslopErrorJson } from "./errors.js";
import {
  ANALYZED_MANIFEST_FILENAMES,
  SUMMARY_CACHE_MAX_BYTES,
  SUMMARY_CACHE_SCHEMA_VERSION,
} from "./constants.js";
import { toPosixPath } from "./utils/to-posix-path.js";

export type PackageFactKind = "substring" | "importReference";

/**
 * A fast-glob-shaped query answered from the already-walked tree instead of a
 * fresh directory scan. Mirrors the fg options the stale-package scans use:
 * `deep` admits files at most that many path segments below `cwd`, `dot`
 * governs whether wildcards match dot-prefixed names (fg default: false), and
 * `ignore` patterns always match dot names (fg behavior).
 */
export interface WalkedFileQuery {
  readonly cwd: string;
  readonly patterns: ReadonlyArray<string>;
  readonly ignore: ReadonlyArray<string>;
  readonly deep: number;
  readonly dot?: boolean;
}

export interface SummaryCache {
  /** The cached collected-file list, or `null` when the tree shape changed. */
  readonly lookupFileList: () => SourceFile[] | null;
  readonly storeFileList: (files: SourceFile[]) => void;
  readonly lookupSummary: (filePath: string) => ParsedSource | null;
  readonly storeSummary: (filePath: string, parsed: ParsedSource) => void;
  readonly lookupResolution: (specifier: string, fromFile: string) => ResolvedImport | null;
  readonly storeResolution: (specifier: string, fromFile: string, resolved: ResolvedImport) => void;
  /**
   * The subset of `names` that `matcher` matches in `filePath`, served from
   * the per-file fact layer when (mtime, size, queried-name-set) all match.
   * Reads the file (and throws like a raw `readFileSync`) only on a miss.
   * Callers must not mutate `names` while iterating one scan loop — the
   * sorted/hashed form is memoized per set instance.
   */
  readonly matchPackageNames: (
    filePath: string,
    kind: PackageFactKind,
    names: ReadonlySet<string>,
    matcher: (content: string, packageName: string) => boolean,
  ) => string[];
  /**
   * The walked files matching a fast-glob-shaped query, sorted, as absolute
   * POSIX paths — the shared-walk replacement for the stale-package `fg.sync`
   * scans (verified byte-identical against fg on real corpora). Returns `null`
   * when the query's `cwd` is not the walk root (e.g. a monorepo root above
   * the scanned project) or a pattern fails to compile; callers then fall
   * back to a real glob scan.
   */
  readonly matchWalkedFiles: (query: WalkedFileQuery) => string[] | null;
  /** Compacts and atomically persists the store; no-op when nothing changed. */
  readonly save: () => void;
}

interface FileStatFingerprint {
  m: number;
  s: number;
}

interface PersistedParsedSource {
  imports?: ParsedSource["imports"];
  exports?: ParsedSource["exports"];
  memberAccesses?: ParsedSource["memberAccesses"];
  wholeObjectUses?: string[];
  localIdentifierReferences?: string[];
  referencedFilenames?: string[];
  redundantTypePatterns?: ParsedSource["redundantTypePatterns"];
  identityWrappers?: ParsedSource["identityWrappers"];
  typeDefinitionHashes?: ParsedSource["typeDefinitionHashes"];
  inlineTypeLiterals?: ParsedSource["inlineTypeLiterals"];
  simplifiableFunctions?: ParsedSource["simplifiableFunctions"];
  simplifiableExpressions?: ParsedSource["simplifiableExpressions"];
  duplicateConstantCandidates?: ParsedSource["duplicateConstantCandidates"];
  errors?: DeslopErrorJson[];
}

interface PersistedSummaryEntry extends FileStatFingerprint {
  p: PersistedParsedSource;
}

interface PersistedPackageFactMatch {
  h: string;
  matched: string[];
}

interface PersistedPackageFactEntry extends FileStatFingerprint {
  substring?: PersistedPackageFactMatch;
  importReference?: PersistedPackageFactMatch;
}

interface PersistedFileList {
  hash: string;
  files: string[];
}

interface PersistedResolution {
  p: string | null;
  e: boolean;
  n: string | null;
}

interface PersistedResolutions {
  hash: string;
  entries: Record<string, PersistedResolution>;
}

interface PersistedSummaryCache {
  version: number;
  scopeHash: string;
  fileList: PersistedFileList | null;
  resolutions: PersistedResolutions | null;
  summaries: Record<string, PersistedSummaryEntry>;
  packageFacts: Record<string, PersistedPackageFactEntry>;
}

interface SortedNameSet {
  sortedNames: string[];
  hash: string;
}

const WALK_SKIP_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);

const MANIFEST_LIKE_FILENAMES = new Set(ANALYZED_MANIFEST_FILENAMES);

const isManifestLikeFileName = (fileName: string): boolean =>
  MANIFEST_LIKE_FILENAMES.has(fileName) ||
  ((fileName.startsWith("tsconfig") || fileName.startsWith("jsconfig")) &&
    fileName.endsWith(".json"));

// The resolver reads bundler/test-runner alias configs by CONTENT
// (`loadBundlerAliasConfigs`), so their stats must invalidate the resolution
// map even though the file NAME set (already in `collectHash`) is unchanged.
const isResolverConfigFileName = (fileName: string): boolean =>
  fileName.includes("webpack") ||
  fileName.startsWith("vite.config.") ||
  fileName.startsWith("vitest.config.") ||
  fileName.startsWith("babel.config.") ||
  fileName.startsWith(".babelrc") ||
  fileName.startsWith("jest.config.");

const sha1Hex = (text: string): string => crypto.createHash("sha1").update(text).digest("hex");

const fileNameOfPosixPath = (posixPath: string): string =>
  posixPath.slice(posixPath.lastIndexOf("/") + 1);

const deslopRequire = createRequire(import.meta.url);

const resolveOwnPackageVersion = (): string => {
  try {
    const packageJson = deslopRequire("deslop-js/package.json");
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
};

const walkTreeStats = (rootDirectory: string): Map<string, FileStatFingerprint> => {
  const collected = new Map<string, FileStatFingerprint>();
  // fast-glob (whose scans this walk both fingerprints and answers via
  // `matchWalkedFiles`) follows directory symlinks, so the walk must too;
  // following each distinct link target once bounds symlink cycles.
  const followedLinkTargets = new Set<string>();
  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRECTORY_NAMES.has(entry.name)) walk(entryPath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        if (WALK_SKIP_DIRECTORY_NAMES.has(entry.name)) continue;
        try {
          const linkStat = statSync(entryPath);
          if (linkStat.isDirectory()) {
            const linkTarget = realpathSync(entryPath);
            if (!followedLinkTargets.has(linkTarget)) {
              followedLinkTargets.add(linkTarget);
              walk(entryPath);
            }
          } else if (linkStat.isFile()) {
            collected.set(entryPath, { m: linkStat.mtimeMs, s: linkStat.size });
          }
        } catch {
          continue;
        }
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const fileStat = statSync(entryPath);
        collected.set(entryPath, { m: fileStat.mtimeMs, s: fileStat.size });
      } catch {
        continue;
      }
    }
  };
  walk(toPosixPath(resolve(rootDirectory)));
  return collected;
};

// One alternation regex over all patterns: the walked-file matcher tests each
// of ~20k paths once instead of once per pattern. `null` on any pattern
// minimatch cannot compile — the caller falls back to a real glob scan.
const compileGlobAlternation = (
  patterns: ReadonlyArray<string>,
  matchDotNames: boolean,
): RegExp | null => {
  const regexSources: string[] = [];
  for (const pattern of patterns) {
    const compiled = new Minimatch(pattern, { dot: matchDotNames }).makeRe();
    if (compiled === false) return null;
    regexSources.push(compiled.source);
  }
  return regexSources.length === 0 ? null : new RegExp(regexSources.join("|"));
};

const countPathSegments = (relativePath: string): number => {
  let segmentCount = 1;
  for (let charIndex = 0; charIndex < relativePath.length; charIndex++) {
    if (relativePath.charCodeAt(charIndex) === 47) segmentCount++;
  }
  return segmentCount;
};

const computeCollectHash = (walkedStats: Map<string, FileStatFingerprint>): string => {
  const fingerprintLines: string[] = [];
  for (const [filePath, fileStat] of walkedStats) {
    fingerprintLines.push(
      isManifestLikeFileName(fileNameOfPosixPath(filePath))
        ? `${filePath}:${fileStat.m}:${fileStat.s}`
        : filePath,
    );
  }
  fingerprintLines.sort();
  return sha1Hex(fingerprintLines.join("\n"));
};

const computeResolutionHash = (
  collectHash: string,
  walkedStats: Map<string, FileStatFingerprint>,
): string => {
  const fingerprintLines: string[] = [];
  for (const [filePath, fileStat] of walkedStats) {
    if (isResolverConfigFileName(fileNameOfPosixPath(filePath))) {
      fingerprintLines.push(`${filePath}:${fileStat.m}:${fileStat.s}`);
    }
  }
  fingerprintLines.sort();
  return sha1Hex(`${collectHash}\n${fingerprintLines.join("\n")}`);
};

// Everything that changes what a stored entry MEANS: parser behavior (the
// deslop version), which project is scanned, what gets collected, and the
// summary-slimming choice (`reportRedundancy`). A mismatch discards the whole
// store rather than risking a stale-semantics hit.
const computeScopeHash = (config: DeslopConfig): string =>
  sha1Hex(
    JSON.stringify({
      deslopVersion: resolveOwnPackageVersion(),
      rootDir: toPosixPath(resolve(config.rootDir)),
      entryPatterns: config.entryPatterns,
      ignorePatterns: config.ignorePatterns,
      includeExtensions: config.includeExtensions,
      reportTypes: config.reportTypes,
      includeEntryExports: config.includeEntryExports,
      reportRedundancy: config.reportRedundancy,
      tsConfigPath: config.tsConfigPath ?? null,
      paths: config.paths ?? null,
    }),
  );

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isOptionalArray = (value: unknown): boolean => value === undefined || Array.isArray(value);

const emptyStore = (scopeHash: string): PersistedSummaryCache => ({
  version: SUMMARY_CACHE_SCHEMA_VERSION,
  scopeHash,
  fileList: null,
  resolutions: null,
  summaries: {},
  packageFacts: {},
});

// Top-level shape validation only; every entry is re-validated at lookup time
// so hand-corrupted (yet JSON-valid) entries degrade to per-item misses. The
// single boundary cast is the JSON-revival idiom shared with core's
// `failOpenReadJson`.
const readPersistedStore = (cachePath: string, scopeHash: string): PersistedSummaryCache => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (
      isRecordValue(parsed) &&
      parsed.version === SUMMARY_CACHE_SCHEMA_VERSION &&
      parsed.scopeHash === scopeHash &&
      isRecordValue(parsed.summaries) &&
      isRecordValue(parsed.packageFacts)
    ) {
      const persisted = parsed as unknown as PersistedSummaryCache;
      return {
        version: SUMMARY_CACHE_SCHEMA_VERSION,
        scopeHash,
        fileList: isRecordValue(persisted.fileList) ? persisted.fileList : null,
        resolutions:
          isRecordValue(persisted.resolutions) &&
          typeof persisted.resolutions.hash === "string" &&
          isRecordValue(persisted.resolutions.entries)
            ? persisted.resolutions
            : null,
        summaries: persisted.summaries,
        packageFacts: persisted.packageFacts,
      };
    }
  } catch {
    // fall through to the empty store
  }
  return emptyStore(scopeHash);
};

// `detectDeadExports` is the only consumer of `localIdentifierReferences`, and
// it only ever queries names of the module's OWN parse-time exports (synthetic
// graph-time re-exports are skipped before the local-use check), so the
// persisted list can be intersected down to those names without changing any
// answer it can produce.
const intersectLocalReferencesWithOwnExports = (parsed: ParsedSource): string[] => {
  if (parsed.localIdentifierReferences.length === 0) return [];
  const ownExportNames = new Set(parsed.exports.map((exportInfo) => exportInfo.name));
  return parsed.localIdentifierReferences.filter((identifierName) =>
    ownExportNames.has(identifierName),
  );
};

const toPersistedArray = <ValueType>(values: ValueType[]): ValueType[] | undefined =>
  values.length > 0 ? values : undefined;

const serializeParsedSource = (
  parsed: ParsedSource,
  shouldPersistDryPatternFields: boolean,
): PersistedParsedSource => ({
  imports: toPersistedArray(parsed.imports),
  exports: toPersistedArray(parsed.exports),
  memberAccesses: toPersistedArray(parsed.memberAccesses),
  wholeObjectUses: toPersistedArray(parsed.wholeObjectUses),
  localIdentifierReferences: toPersistedArray(intersectLocalReferencesWithOwnExports(parsed)),
  referencedFilenames: toPersistedArray(parsed.referencedFilenames),
  ...(shouldPersistDryPatternFields
    ? {
        redundantTypePatterns: toPersistedArray(parsed.redundantTypePatterns),
        identityWrappers: toPersistedArray(parsed.identityWrappers),
        typeDefinitionHashes: toPersistedArray(parsed.typeDefinitionHashes),
        inlineTypeLiterals: toPersistedArray(parsed.inlineTypeLiterals),
        simplifiableFunctions: toPersistedArray(parsed.simplifiableFunctions),
        simplifiableExpressions: toPersistedArray(parsed.simplifiableExpressions),
        duplicateConstantCandidates: toPersistedArray(parsed.duplicateConstantCandidates),
      }
    : {}),
  errors: toPersistedArray(parsed.errors.map((deslopError) => deslopError.toJSON())),
});

const isPersistedErrorJson = (value: unknown): value is DeslopErrorJson =>
  isRecordValue(value) &&
  typeof value.code === "string" &&
  typeof value.module === "string" &&
  typeof value.message === "string";

const PERSISTED_SOURCE_ARRAY_FIELDS = [
  "imports",
  "exports",
  "memberAccesses",
  "wholeObjectUses",
  "localIdentifierReferences",
  "referencedFilenames",
  "redundantTypePatterns",
  "identityWrappers",
  "typeDefinitionHashes",
  "inlineTypeLiterals",
  "simplifiableFunctions",
  "simplifiableExpressions",
  "duplicateConstantCandidates",
  "errors",
] as const;

const reviveParsedSource = (persisted: unknown): ParsedSource | null => {
  if (!isRecordValue(persisted)) return null;
  for (const fieldName of PERSISTED_SOURCE_ARRAY_FIELDS) {
    if (!isOptionalArray(persisted[fieldName])) return null;
  }
  const source = persisted as unknown as PersistedParsedSource;
  const persistedErrors = source.errors ?? [];
  if (!persistedErrors.every(isPersistedErrorJson)) return null;
  return {
    imports: source.imports ?? [],
    exports: source.exports ?? [],
    memberAccesses: source.memberAccesses ?? [],
    wholeObjectUses: source.wholeObjectUses ?? [],
    localIdentifierReferences: source.localIdentifierReferences ?? [],
    referencedFilenames: source.referencedFilenames ?? [],
    redundantTypePatterns: source.redundantTypePatterns ?? [],
    identityWrappers: source.identityWrappers ?? [],
    typeDefinitionHashes: source.typeDefinitionHashes ?? [],
    inlineTypeLiterals: source.inlineTypeLiterals ?? [],
    simplifiableFunctions: source.simplifiableFunctions ?? [],
    simplifiableExpressions: source.simplifiableExpressions ?? [],
    duplicateConstantCandidates: source.duplicateConstantCandidates ?? [],
    errors: persistedErrors.map(
      (errorJson) =>
        new DeslopError({
          code: errorJson.code,
          module: errorJson.module,
          severity: errorJson.severity,
          message: errorJson.message,
          path: errorJson.path,
          detail: errorJson.detail,
        }),
    ),
  };
};

const atomicWriteFile = (filePath: string, contents: string): void => {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, contents);
    renameSync(temporaryPath, filePath);
  } catch {
    // A cache that cannot persist must never break the analysis.
  }
};

const createSummaryCache = (cachePath: string, config: DeslopConfig): SummaryCache => {
  const scopeHash = computeScopeHash(config);
  const store = readPersistedStore(cachePath, scopeHash);
  const walkRoot = toPosixPath(resolve(config.rootDir));
  const walkedStats = walkTreeStats(config.rootDir);
  const collectHash = computeCollectHash(walkedStats);
  const resolutionHash = computeResolutionHash(collectHash, walkedStats);
  const shouldPersistDryPatternFields = config.reportRedundancy;

  if (store.resolutions === null || store.resolutions.hash !== resolutionHash) {
    store.resolutions = { hash: resolutionHash, entries: {} };
  }
  const resolutionEntries = store.resolutions.entries;

  let isDirty = false;
  const activeSummaryPaths = new Set<string>();
  const activeResolutionKeys = new Set<string>();
  const activeFactPaths = new Set<string>();
  const sortedNameSetMemo = new WeakMap<ReadonlySet<string>, SortedNameSet>();

  const statOf = (filePath: string): FileStatFingerprint | null => {
    const walked = walkedStats.get(filePath);
    if (walked) return walked;
    try {
      const fileStat = statSync(filePath);
      return { m: fileStat.mtimeMs, s: fileStat.size };
    } catch {
      return null;
    }
  };

  return {
    lookupFileList: () => {
      const cachedFileList = store.fileList;
      if (
        cachedFileList === null ||
        cachedFileList.hash !== collectHash ||
        !isStringArray(cachedFileList.files)
      ) {
        return null;
      }
      return cachedFileList.files.map((filePath, fileIndex) => ({
        index: fileIndex,
        path: filePath,
      }));
    },

    storeFileList: (files) => {
      store.fileList = {
        hash: collectHash,
        files: files.map((file) => file.path),
      };
      isDirty = true;
    },

    lookupSummary: (filePath) => {
      const cachedSummary = store.summaries[filePath];
      if (!isRecordValue(cachedSummary)) return null;
      const fileStat = statOf(filePath);
      if (!fileStat || fileStat.m !== cachedSummary.m || fileStat.s !== cachedSummary.s) {
        return null;
      }
      const revived = reviveParsedSource(cachedSummary.p);
      if (revived === null) return null;
      activeSummaryPaths.add(filePath);
      return revived;
    },

    storeSummary: (filePath, parsed) => {
      const fileStat = statOf(filePath);
      if (!fileStat) return;
      store.summaries[filePath] = {
        m: fileStat.m,
        s: fileStat.s,
        p: serializeParsedSource(parsed, shouldPersistDryPatternFields),
      };
      activeSummaryPaths.add(filePath);
      isDirty = true;
    },

    lookupResolution: (specifier, fromFile) => {
      const resolutionKey = `${dirname(fromFile)}::${specifier}`;
      const cachedResolution = resolutionEntries[resolutionKey];
      if (!isRecordValue(cachedResolution) || typeof cachedResolution.e !== "boolean") {
        return null;
      }
      activeResolutionKeys.add(resolutionKey);
      return {
        resolvedPath: typeof cachedResolution.p === "string" ? cachedResolution.p : undefined,
        isExternal: cachedResolution.e,
        packageName: typeof cachedResolution.n === "string" ? cachedResolution.n : undefined,
      };
    },

    storeResolution: (specifier, fromFile, resolved) => {
      const resolutionKey = `${dirname(fromFile)}::${specifier}`;
      resolutionEntries[resolutionKey] = {
        p: resolved.resolvedPath ?? null,
        e: resolved.isExternal,
        n: resolved.packageName ?? null,
      };
      activeResolutionKeys.add(resolutionKey);
      isDirty = true;
    },

    matchPackageNames: (filePath, kind, names, matcher) => {
      let nameSet = sortedNameSetMemo.get(names);
      if (nameSet === undefined) {
        const sortedNames = [...names].sort();
        nameSet = { sortedNames, hash: sha1Hex(sortedNames.join("\n")) };
        sortedNameSetMemo.set(names, nameSet);
      }
      activeFactPaths.add(filePath);
      const fileStat = statOf(filePath);
      const existingEntry = store.packageFacts[filePath];
      const validEntry =
        fileStat !== null &&
        isRecordValue(existingEntry) &&
        existingEntry.m === fileStat.m &&
        existingEntry.s === fileStat.s
          ? existingEntry
          : null;
      const existingMatch = validEntry?.[kind];
      if (
        isRecordValue(existingMatch) &&
        existingMatch.h === nameSet.hash &&
        isStringArray(existingMatch.matched)
      ) {
        return existingMatch.matched;
      }
      const content = readFileSync(filePath, "utf-8");
      const matchedNames = nameSet.sortedNames.filter((packageName) =>
        matcher(content, packageName),
      );
      if (fileStat !== null) {
        const factEntry = validEntry ?? { m: fileStat.m, s: fileStat.s };
        factEntry[kind] = { h: nameSet.hash, matched: matchedNames };
        store.packageFacts[filePath] = factEntry;
        isDirty = true;
      }
      return matchedNames;
    },

    matchWalkedFiles: (query) => {
      if (toPosixPath(resolve(query.cwd)) !== walkRoot) return null;
      const positiveMatcher = compileGlobAlternation(query.patterns, query.dot === true);
      if (positiveMatcher === null) return null;
      const ignoreMatcher =
        query.ignore.length > 0 ? compileGlobAlternation(query.ignore, true) : null;
      if (query.ignore.length > 0 && ignoreMatcher === null) return null;
      const rootPrefixLength = walkRoot.length + 1;
      const matchedPaths: string[] = [];
      for (const filePath of walkedStats.keys()) {
        const relativePath = filePath.slice(rootPrefixLength);
        if (countPathSegments(relativePath) > query.deep) continue;
        if (ignoreMatcher !== null && ignoreMatcher.test(relativePath)) continue;
        if (positiveMatcher.test(relativePath)) matchedPaths.push(filePath);
      }
      return matchedPaths.sort();
    },

    save: () => {
      if (!isDirty) return;
      const compactedSummaries: Record<string, PersistedSummaryEntry> = {};
      for (const filePath of activeSummaryPaths) {
        const summaryEntry = store.summaries[filePath];
        if (summaryEntry !== undefined) compactedSummaries[filePath] = summaryEntry;
      }
      const compactedFacts: Record<string, PersistedPackageFactEntry> = {};
      for (const filePath of activeFactPaths) {
        const factEntry = store.packageFacts[filePath];
        if (factEntry !== undefined) compactedFacts[filePath] = factEntry;
      }
      const compactedResolutions: Record<string, PersistedResolution> = {};
      for (const resolutionKey of activeResolutionKeys) {
        const resolutionEntry = resolutionEntries[resolutionKey];
        if (resolutionEntry !== undefined) compactedResolutions[resolutionKey] = resolutionEntry;
      }
      const serialized = JSON.stringify({
        version: SUMMARY_CACHE_SCHEMA_VERSION,
        scopeHash,
        fileList: store.fileList,
        resolutions: { hash: resolutionHash, entries: compactedResolutions },
        summaries: compactedSummaries,
        packageFacts: compactedFacts,
      } satisfies PersistedSummaryCache);
      if (serialized.length > SUMMARY_CACHE_MAX_BYTES) return;
      atomicWriteFile(cachePath, serialized);
    },
  };
};

/**
 * Loads the incremental cache configured at `config.incrementalCachePath`.
 * Returns `null` (analysis runs exactly as without a cache) when the path is
 * unset or anything about initialization fails.
 */
export const loadSummaryCache = (config: DeslopConfig): SummaryCache | null => {
  if (!config.incrementalCachePath) return null;
  try {
    return createSummaryCache(config.incrementalCachePath, config);
  } catch {
    return null;
  }
};
