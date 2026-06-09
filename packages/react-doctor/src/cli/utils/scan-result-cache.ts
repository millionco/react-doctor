import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { computeConfigFingerprint } from "@react-doctor/core";
import type {
  Diagnostic,
  InspectOutput,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";
import {
  CACHE_FILENAME_HASH_LENGTH_CHARS,
  SCAN_RESULT_CACHE_MAX_ENTRY_COUNT,
  SCAN_RESULT_CACHE_SCHEMA_VERSION,
} from "./constants.js";
import type { ResolvedInspectOptions } from "../../inspect.js";

interface StringUnknownRecord {
  readonly [key: string]: unknown;
}

export interface CachedScanPayload {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly project: InspectResult["project"];
  readonly userConfig: ReactDoctorConfig | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  readonly directory: string;
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly scanElapsedMilliseconds: number;
  readonly baselineDelta: InspectResult["baselineDelta"];
  readonly lintFailureReasonKind: InspectOutput["lintFailureReasonKind"];
}

interface PersistedScanResultCacheEntry {
  readonly key: string;
  readonly createdAtMs: number;
  readonly payload: CachedScanPayload;
}

interface PersistedScanResultCache {
  readonly version: number;
  readonly entries: ReadonlyArray<PersistedScanResultCacheEntry>;
}

interface ScanResultCache {
  readonly lookup: (key: string) => CachedScanPayload | null;
  readonly store: (key: string, payload: CachedScanPayload) => void;
}

interface ScanResultCacheKeyInput {
  readonly projectDirectory: string;
  readonly version: string;
  readonly nodeBinaryPath: string | null;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasConfigOverride: boolean;
  readonly configSourceDirectory: string | null;
}

const CACHE_DISABLED_VALUES = new Set(["1", "true"]);
const TOOLCHAIN_PACKAGE_SPECIFIERS = [
  "oxlint",
  "oxlint/package.json",
  "oxlint-plugin-react-doctor",
  "deslop-js/package.json",
  "eslint-plugin-react-hooks/package.json",
] as const;
const bundledRequire = createRequire(import.meta.url);

const isRecord = (value: unknown): value is StringUnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeForStableJson = (value: unknown): unknown => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return value;
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new Error("Unsupported cache key value");
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeForStableJson(item);
      return normalized === undefined ? null : normalized;
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Unsupported cache key object");
  }
  const record = value as StringUnknownRecord;
  const normalizedRecord: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const normalized = normalizeForStableJson(record[key]);
    if (normalized !== undefined) normalizedRecord[key] = normalized;
  }
  return normalizedRecord;
};

const stringifyStableJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(normalizeForStableJson(value));
  } catch {
    return null;
  }
};

const hashString = (value: string): string => crypto.createHash("sha1").update(value).digest("hex");

const runGit = (directory: string, args: ReadonlyArray<string>): string | null => {
  try {
    return execFileSync("git", [...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const readHeadSha = (projectDirectory: string): string | null =>
  runGit(projectDirectory, ["rev-parse", "HEAD"]);

const isWorktreeClean = (projectDirectory: string): boolean => {
  const status = runGit(projectDirectory, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  return status !== null && status.length === 0;
};

const hasHiddenTrackedFileState = (projectDirectory: string): boolean => {
  const output = runGit(projectDirectory, ["ls-files", "-v"]);
  if (output === null) return true;
  return output.split("\n").some((line) => line.length > 0 && line[0] !== "H");
};

const resolveCacheFilePath = (projectDirectory: string): string => {
  const nodeModulesDirectory = path.join(projectDirectory, "node_modules");
  if (fs.existsSync(nodeModulesDirectory)) {
    return path.join(nodeModulesDirectory, ".cache", "react-doctor", "scan-cache.json");
  }
  const projectHash = hashString(projectDirectory).slice(0, CACHE_FILENAME_HASH_LENGTH_CHARS);
  return path.join(os.tmpdir(), "react-doctor-cache", `scan-${projectHash}.json`);
};

const readPersistedCache = (cacheFilePath: string): PersistedScanResultCache => {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFilePath, "utf8"));
    if (!isRecord(parsed) || parsed.version !== SCAN_RESULT_CACHE_SCHEMA_VERSION) {
      return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
    }
    if (!Array.isArray(parsed.entries)) {
      return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
    }
    const entries: PersistedScanResultCacheEntry[] = [];
    for (const entry of parsed.entries) {
      if (
        !isRecord(entry) ||
        typeof entry.key !== "string" ||
        typeof entry.createdAtMs !== "number"
      ) {
        continue;
      }
      if (!isRecord(entry.payload) || !Array.isArray(entry.payload.diagnostics)) continue;
      entries.push(entry as unknown as PersistedScanResultCacheEntry);
    }
    return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries };
  } catch {
    return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
  }
};

const writePersistedCache = (cacheFilePath: string, cache: PersistedScanResultCache): void => {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
    const tempPath = `${cacheFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(cache));
    fs.renameSync(tempPath, cacheFilePath);
  } catch {
    return;
  }
};

const isScanResultCacheDisabled = (): boolean =>
  CACHE_DISABLED_VALUES.has(process.env.REACT_DOCTOR_NO_CACHE?.toLowerCase() ?? "");

const resolveProjectIdentity = (projectDirectory: string): string => {
  try {
    return fs.realpathSync.native(projectDirectory);
  } catch {
    return path.resolve(projectDirectory);
  }
};

const fileFingerprint = (filePath: string): string | null => {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
};

const resolveToolchainFingerprint = (nodeBinaryPath: string | null): ReadonlyArray<string> => {
  const fingerprints: string[] = [];
  if (nodeBinaryPath !== null) {
    const fingerprint = fileFingerprint(nodeBinaryPath);
    if (fingerprint !== null) fingerprints.push(`node=${fingerprint}`);
  }
  for (const specifier of TOOLCHAIN_PACKAGE_SPECIFIERS) {
    try {
      const resolvedPath = bundledRequire.resolve(specifier);
      const fingerprint = fileFingerprint(resolvedPath);
      if (fingerprint !== null) fingerprints.push(`${specifier}=${fingerprint}`);
    } catch {
      continue;
    }
  }
  return fingerprints;
};

export const buildScanResultCacheKey = (input: ScanResultCacheKeyInput): string | null => {
  if (isScanResultCacheDisabled()) return null;
  if (!isWorktreeClean(input.projectDirectory)) return null;
  if (hasHiddenTrackedFileState(input.projectDirectory)) return null;
  const headSha = readHeadSha(input.projectDirectory);
  if (headSha === null) return null;
  const userConfigJson = stringifyStableJson(input.userConfig);
  if (userConfigJson === null) return null;
  const cacheKeyJson = stringifyStableJson({
    schemaVersion: SCAN_RESULT_CACHE_SCHEMA_VERSION,
    projectIdentity: resolveProjectIdentity(input.projectDirectory),
    headSha,
    reactDoctorVersion: input.version,
    nodeVersion: process.version,
    toolchainFingerprint: resolveToolchainFingerprint(input.nodeBinaryPath),
    configFingerprint: computeConfigFingerprint(input.projectDirectory, input.version),
    hasConfigOverride: input.hasConfigOverride,
    configSourceDirectory: input.configSourceDirectory,
    userConfig: input.userConfig,
    engineOptions: {
      lint: input.options.lint,
      deadCode: input.options.deadCode,
      includePaths: [...input.options.includePaths].sort(),
      customRulesOnly: input.options.customRulesOnly,
      respectInlineDisables: input.options.respectInlineDisables,
      warnings: input.options.warnings,
      adoptExistingLintConfig: input.options.adoptExistingLintConfig,
      ignoredTags: [...input.options.ignoredTags].sort(),
      concurrency: input.options.concurrency,
      baselineRef: input.options.baseline?.ref,
      noScore: input.options.noScore,
      isCi: input.options.isCi,
      suppressRendering: input.options.suppressRendering,
    },
  });
  return cacheKeyJson === null ? null : hashString(cacheKeyJson);
};

export const createScanResultCache = (projectDirectory: string): ScanResultCache => {
  const cacheFilePath = resolveCacheFilePath(projectDirectory);
  const persistedCache = readPersistedCache(cacheFilePath);
  const entries = new Map<string, PersistedScanResultCacheEntry>();
  for (const entry of persistedCache.entries) entries.set(entry.key, entry);

  const persist = (): void => {
    const prunedEntries = [...entries.values()]
      .sort((firstEntry, secondEntry) => secondEntry.createdAtMs - firstEntry.createdAtMs)
      .slice(0, SCAN_RESULT_CACHE_MAX_ENTRY_COUNT);
    writePersistedCache(cacheFilePath, {
      version: SCAN_RESULT_CACHE_SCHEMA_VERSION,
      entries: prunedEntries,
    });
  };

  return {
    lookup: (key) => entries.get(key)?.payload ?? null,
    store: (key, payload) => {
      entries.set(key, { key, createdAtMs: Date.now(), payload });
      persist();
    },
  };
};

export const shouldStoreScanPayload = (payload: CachedScanPayload): boolean =>
  !payload.didLintFail && !payload.didDeadCodeFail && payload.lintPartialFailures.length === 0;
