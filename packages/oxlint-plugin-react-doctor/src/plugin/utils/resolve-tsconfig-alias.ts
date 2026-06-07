import * as fs from "node:fs";
import * as path from "node:path";
import {
  CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS,
  TSCONFIG_EXTENDS_MAX_DEPTH,
} from "../constants/thresholds.js";
import { resolveModuleFileFromAbsolutePath } from "./resolve-relative-import-path.js";

interface ResolvedTsconfig {
  // Directory that bare `baseUrl` imports and `paths` targets resolve
  // against (the configured `baseUrl`, else the tsconfig's own dir).
  readonly baseAbsolutePath: string;
  readonly hasExplicitBaseUrl: boolean;
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

const TSCONFIG_FILE_NAMES = ["tsconfig.json", "jsconfig.json"];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Strips `//` line + `/* */` block comments and trailing commas from a
// JSONC document (tsconfig.json is JSONC), while preserving comment-like
// sequences that appear inside string literals.
const stripJsonComments = (text: string): string => {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (inLineComment) {
      if (character === "\n") {
        inLineComment = false;
        output += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (inString) {
      output += character;
      if (character === "\\") {
        output += nextCharacter ?? "";
        index++;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index++;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index++;
      continue;
    }
    output += character;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
};

const parseTsconfigFile = (configFilePath: string): Record<string, unknown> | null => {
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(configFilePath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(sourceText));
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const resolveExtendsPath = (extendsValue: string, fromConfigDirectory: string): string | null => {
  const withExtension = extendsValue.endsWith(".json") ? extendsValue : `${extendsValue}.json`;
  if (extendsValue.startsWith("./") || extendsValue.startsWith("../")) {
    return path.resolve(fromConfigDirectory, withExtension);
  }
  // Bare specifier (e.g. `@tsconfig/next/tsconfig.json`): resolve from
  // the config dir's node_modules. Bounded, best-effort.
  return path.join(fromConfigDirectory, "node_modules", withExtension);
};

const parsePathsField = (pathsField: unknown): Map<string, readonly string[]> => {
  const paths = new Map<string, readonly string[]>();
  if (!isObjectRecord(pathsField)) return paths;
  for (const [pattern, targets] of Object.entries(pathsField)) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter((target): target is string => typeof target === "string");
    if (stringTargets.length > 0) paths.set(pattern, stringTargets);
  }
  return paths;
};

// Reads a tsconfig + its `extends` chain into the effective `baseUrl` +
// `paths`. A `paths` field — even empty — REPLACES inherited paths (TS
// does not deep-merge `compilerOptions.paths` across `extends`); a
// config with no `paths` field inherits them (and their anchor) from the
// chain. `paths`/`baseUrl` resolve against the directory of the config
// that declares them, matching how TypeScript anchors them.
const readResolvedTsconfig = (
  configFilePath: string,
  extendsDepth: number,
): ResolvedTsconfig | null => {
  const parsed = parseTsconfigFile(configFilePath);
  if (!parsed) return null;

  const configDirectory = path.dirname(configFilePath);
  const compilerOptions = isObjectRecord(parsed.compilerOptions) ? parsed.compilerOptions : {};
  const baseUrlValue = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null;
  const hasExplicitBaseUrl = baseUrlValue !== null;
  const baseAbsolutePath =
    baseUrlValue !== null ? path.resolve(configDirectory, baseUrlValue) : configDirectory;

  if (isObjectRecord(compilerOptions.paths)) {
    return { baseAbsolutePath, hasExplicitBaseUrl, paths: parsePathsField(compilerOptions.paths) };
  }

  if (typeof parsed.extends === "string" && extendsDepth < TSCONFIG_EXTENDS_MAX_DEPTH) {
    const parentPath = resolveExtendsPath(parsed.extends, configDirectory);
    const inherited = parentPath ? readResolvedTsconfig(parentPath, extendsDepth + 1) : null;
    if (inherited) return inherited;
  }

  return hasExplicitBaseUrl ? { baseAbsolutePath, hasExplicitBaseUrl, paths: new Map() } : null;
};

interface CacheEntry {
  readonly mtimeMs: number;
  readonly config: ResolvedTsconfig | null;
}

const configByFilePath = new Map<string, CacheEntry>();

const loadTsconfigCached = (configFilePath: string): ResolvedTsconfig | null => {
  let fileStat: fs.Stats;
  try {
    fileStat = fs.statSync(configFilePath);
  } catch {
    return null;
  }
  const cached = configByFilePath.get(configFilePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) return cached.config;

  const config = readResolvedTsconfig(configFilePath, 0);
  configByFilePath.set(configFilePath, { mtimeMs: fileStat.mtimeMs, config });
  return config;
};

// Walks up from `fromDirectory` for the nearest tsconfig/jsconfig. The
// walk itself is NOT cached by directory — only parsed configs are
// (mtime-keyed in `loadTsconfigCached`) — so a long-lived process (the
// language server) picks up tsconfig edits and newly-added configs
// instead of serving a stale result. The per-call statSyncs are cheap
// and bounded by CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS.
const findNearestTsconfig = (fromDirectory: string): ResolvedTsconfig | null => {
  let currentDirectory = fromDirectory;
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    for (const fileName of TSCONFIG_FILE_NAMES) {
      const candidate = loadTsconfigCached(path.join(currentDirectory, fileName));
      if (candidate) return candidate;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  return null;
};

const matchPathPattern = (source: string, pattern: string): string | null => {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) return source === pattern ? "" : null;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (
    source.length >= prefix.length + suffix.length &&
    source.startsWith(prefix) &&
    source.endsWith(suffix)
  ) {
    return source.slice(prefix.length, source.length - suffix.length);
  }
  return null;
};

// Resolves a non-relative import `source` (e.g. `@/components/Search`)
// through the nearest tsconfig/jsconfig `paths` + `baseUrl` to a
// concrete file on disk, or null when no alias matches. Relative
// imports are NOT handled here — callers resolve those first.
export const resolveTsconfigAliasPath = (fromFilename: string, source: string): string | null => {
  const config = findNearestTsconfig(path.dirname(fromFilename));
  if (!config) return null;

  let bestPattern: string | null = null;
  let bestCapture = "";
  let bestPrefixLength = -1;
  for (const pattern of config.paths.keys()) {
    const capture = matchPathPattern(source, pattern);
    if (capture === null) continue;
    const starIndex = pattern.indexOf("*");
    const prefixLength = starIndex === -1 ? pattern.length : starIndex;
    if (prefixLength > bestPrefixLength) {
      bestPattern = pattern;
      bestCapture = capture;
      bestPrefixLength = prefixLength;
    }
  }

  if (bestPattern) {
    for (const target of config.paths.get(bestPattern) ?? []) {
      // A tsconfig `paths` target contains at most one `*`; replaceAll
      // keeps the substitution complete (and silences scanners that flag
      // single-occurrence replace as incomplete encoding).
      const substituted = target.replaceAll("*", bestCapture);
      const resolved = resolveModuleFileFromAbsolutePath(
        path.resolve(config.baseAbsolutePath, substituted),
      );
      if (resolved) return resolved;
    }
  }

  // `baseUrl`-relative resolution for bare non-aliased imports
  // (`import "components/Search"` with `baseUrl: "src"`).
  if (config.hasExplicitBaseUrl) {
    return resolveModuleFileFromAbsolutePath(path.resolve(config.baseAbsolutePath, source));
  }
  return null;
};

// Exposed for tests; production callers rely on mtime-based invalidation.
export const __clearTsconfigAliasCacheForTests = (): void => {
  configByFilePath.clear();
};
