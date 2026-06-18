import picomatch from "picomatch";
import { MAX_GLOB_PATTERN_LENGTH_CHARS, MAX_GLOB_PATTERN_WILDCARD_COUNT } from "../constants.js";
import { messageFromUnknown } from "./message-from-unknown.js";

export class InvalidGlobPatternError extends Error {
  public readonly pattern: string;
  public readonly reason: string;

  public constructor(pattern: string, reason: string) {
    super(`Invalid glob pattern ${JSON.stringify(pattern)}: ${reason}`);
    this.name = "InvalidGlobPatternError";
    this.pattern = pattern;
    this.reason = reason;
  }
}

const assertGlobPattern = (condition: boolean, pattern: string, reason: string): void => {
  if (!condition) throw new InvalidGlobPatternError(pattern, reason);
};

const countGlobWildcards = (pattern: string): number => (pattern.match(/[*?]/g) ?? []).length;

const normalizeGlobPattern = (pattern: string): string =>
  pattern.replace(/\\/g, "/").replace(/^\//, "");

// Reuse the same `picomatch` options everywhere so behavior stays
// identical across compilation sites. `dot: true` preserves the
// historical hand-rolled compiler's behavior (no dotfile distinction).
// `strictSlashes: false` keeps trailing-slash matching forgiving
// (e.g. `src/**` matches `src` as well as nested paths). `windows:
// false` forces POSIX semantics because callers pre-normalize paths
// via `toRelativePath` before testing.
const PICOMATCH_OPTIONS: picomatch.PicomatchOptions = {
  dot: true,
  strictSlashes: false,
  windows: false,
};

export const compileGlobPattern = (rawPattern: string): RegExp => {
  assertGlobPattern(
    typeof rawPattern === "string" && rawPattern.length > 0,
    String(rawPattern),
    "pattern must be a non-empty string.",
  );
  assertGlobPattern(
    rawPattern.length <= MAX_GLOB_PATTERN_LENGTH_CHARS,
    rawPattern,
    `pattern length ${rawPattern.length} exceeds the maximum of ${MAX_GLOB_PATTERN_LENGTH_CHARS} characters.`,
  );
  const wildcardCount = countGlobWildcards(rawPattern);
  assertGlobPattern(
    wildcardCount <= MAX_GLOB_PATTERN_WILDCARD_COUNT,
    rawPattern,
    `pattern uses ${wildcardCount} wildcards (\`*\` / \`?\`), exceeding the maximum of ${MAX_GLOB_PATTERN_WILDCARD_COUNT}. This guards against catastrophic backtracking from pathological patterns; split the pattern into multiple smaller entries.`,
  );

  try {
    return picomatch.makeRe(normalizeGlobPattern(rawPattern), PICOMATCH_OPTIONS);
  } catch (caughtError) {
    throw new InvalidGlobPatternError(rawPattern, messageFromUnknown(caughtError));
  }
};

// Compiles a list of glob patterns, routing each `InvalidGlobPatternError`
// to `onInvalid` and dropping the offender so a single bad entry in a
// user config can't take down a whole scan. Non-glob errors still
// propagate.
export const compileGlobPatternsLenient = (
  patterns: readonly string[],
  onInvalid: (error: InvalidGlobPatternError) => void,
): RegExp[] => {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(compileGlobPattern(pattern));
    } catch (caughtError) {
      if (!(caughtError instanceof InvalidGlobPatternError)) throw caughtError;
      onInvalid(caughtError);
    }
  }
  return compiled;
};
