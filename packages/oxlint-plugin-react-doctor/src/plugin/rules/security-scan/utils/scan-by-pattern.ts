import { SOURCE_FILE_PATTERN } from "../../../constants/security-scan.js";
import type { FileScan, ScannedFile } from "../../../utils/file-scan.js";
import { getLocationAtIndex } from "./get-location-at-index.js";
import { isFirebaseRulesPath } from "./is-firebase-rules-path.js";
import {
  stripCommentsAndStringLiteralsPreservingPositions,
  stripCommentsPreservingPositions,
} from "./strip-comments-preserving-positions.js";

export interface ScanByPatternInput {
  readonly shouldScan: (file: ScannedFile) => boolean;
  // One pattern, or a disjunction tried in order — the first pattern that
  // matches the file content locates the finding.
  readonly pattern: RegExp | ReadonlyArray<RegExp>;
  // Conjunction gates: every pattern must also match somewhere in the file
  // (e.g. an MCP import that proves the matched tool surface is MCP).
  readonly requireAll?: ReadonlyArray<RegExp>;
  // Veto: a match anywhere in the file suppresses the finding (e.g. a
  // signature-verification call that answers the rule's concern).
  readonly suppressWhen?: RegExp;
  // Blank string-literal interiors before matching, so a keyword that appears
  // only in prose (a tool `description: "...fetch..."`) is not mistaken for a
  // real call site. Off by default — most rules legitimately scan string
  // contents (URLs, secrets, install commands).
  readonly ignoreStringLiterals?: boolean;
  readonly message: string;
}

const strippedContentCache = new WeakMap<ScannedFile, string>();
const stringStrippedContentCache = new WeakMap<ScannedFile, string>();

// Comments are a recurring false-positive source ("Ajv compiles schemas via
// `new Function(...)`"); blank them for JS/TS files before pattern matching.
// Stripping preserves offsets, so reported lines/columns stay correct.
export const getScannableContent = (file: ScannedFile, ignoreStringLiterals = false): string => {
  // Firebase/CEL `.rules` files use `//` and `/* */` comments too, so a
  // cautionary commented-out `allow … if true` must be blanked before scanning
  // (the comment stripper is regex-literal-agnostic, so `match /users/{uid}`
  // survives intact).
  if (!SOURCE_FILE_PATTERN.test(file.relativePath) && !isFirebaseRulesPath(file.relativePath)) {
    return file.content;
  }
  const cache = ignoreStringLiterals ? stringStrippedContentCache : strippedContentCache;
  const cachedContent = cache.get(file);
  if (cachedContent !== undefined) return cachedContent;
  const strippedContent = ignoreStringLiterals
    ? stripCommentsAndStringLiteralsPreservingPositions(file.content)
    : stripCommentsPreservingPositions(file.content);
  cache.set(file, strippedContent);
  return strippedContent;
};

export const scanByPattern =
  ({
    shouldScan,
    pattern,
    requireAll,
    suppressWhen,
    ignoreStringLiterals,
    message,
  }: ScanByPatternInput): FileScan =>
  (file) => {
    if (!shouldScan(file)) return [];
    const content = getScannableContent(file, ignoreStringLiterals);
    if (requireAll !== undefined && !requireAll.every((gate) => gate.test(content))) {
      return [];
    }
    let matchIndex = -1;
    if (pattern instanceof RegExp) {
      matchIndex = content.search(pattern);
    } else {
      for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
        matchIndex = content.search(pattern[patternIndex]);
        if (matchIndex >= 0) break;
      }
    }
    if (matchIndex < 0) return [];
    if (suppressWhen !== undefined && suppressWhen.test(content)) return [];
    const { line, column } = getLocationAtIndex(content, matchIndex);
    return [{ message, line, column }];
  };
