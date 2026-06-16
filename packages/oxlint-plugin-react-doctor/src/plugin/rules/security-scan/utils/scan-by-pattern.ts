import { SOURCE_FILE_PATTERN } from "../../../constants/security-scan.js";
import type { FileScan, ScannedFile } from "../../../utils/file-scan.js";
import { getMatchLocation } from "./get-match-location.js";
import { stripCommentsPreservingPositions } from "./strip-comments-preserving-positions.js";
import { stripStringLiteralsKeepingModuleSpecifiers } from "./strip-string-literals-keeping-module-specifiers.js";

export interface ScanByPatternInput {
  readonly shouldScan: (file: ScannedFile) => boolean;
  // One pattern, or a disjunction tried in order — the first pattern that
  // matches the file content locates the finding.
  readonly pattern: RegExp | ReadonlyArray<RegExp>;
  // Conjunction gates: every pattern must also match somewhere in the file
  // (e.g. an MCP import that proves the matched tool surface is MCP).
  readonly requireAll?: ReadonlyArray<RegExp>;
  // Conjunction gates that must match in CODE only — comments and prose
  // string-literal contents are blanked before testing (module-specifier
  // strings are kept, since an import path is code), so a capability keyword
  // that appears solely inside a `description` string doesn't count.
  readonly requireAllInCode?: ReadonlyArray<RegExp>;
  // Veto: a match anywhere in the file suppresses the finding (e.g. a
  // signature-verification call that answers the rule's concern).
  readonly suppressWhen?: RegExp;
  readonly message: string;
}

const strippedContentCache = new WeakMap<ScannedFile, string>();
const codeOnlyContentCache = new WeakMap<ScannedFile, string>();

// Comments are a recurring false-positive source ("Ajv compiles schemas via
// `new Function(...)`"); blank them for JS/TS files before pattern matching.
// Stripping preserves offsets, so reported lines/columns stay correct.
export const getScannableContent = (file: ScannedFile): string => {
  if (!SOURCE_FILE_PATTERN.test(file.relativePath)) return file.content;
  const cachedContent = strippedContentCache.get(file);
  if (cachedContent !== undefined) return cachedContent;
  const strippedContent = stripCommentsPreservingPositions(file.content);
  strippedContentCache.set(file, strippedContent);
  return strippedContent;
};

// Comments AND prose string-literal contents blanked (import paths kept) — the
// "is this keyword in real code?" view used by `requireAllInCode` gates so prose
// inside a `description` string can't satisfy a capability gate, while a
// dangerous import like `from "node:child_process"` still counts.
const getCodeOnlyContent = (file: ScannedFile): string => {
  const cachedContent = codeOnlyContentCache.get(file);
  if (cachedContent !== undefined) return cachedContent;
  const codeOnlyContent = stripStringLiteralsKeepingModuleSpecifiers(getScannableContent(file));
  codeOnlyContentCache.set(file, codeOnlyContent);
  return codeOnlyContent;
};

export const scanByPattern =
  ({
    shouldScan,
    pattern,
    requireAll,
    requireAllInCode,
    suppressWhen,
    message,
  }: ScanByPatternInput): FileScan =>
  (file) => {
    if (!shouldScan(file)) return [];
    const content = getScannableContent(file);
    if (requireAll !== undefined && !requireAll.every((gate) => gate.test(content))) {
      return [];
    }
    if (
      requireAllInCode !== undefined &&
      !requireAllInCode.every((gate) => gate.test(getCodeOnlyContent(file)))
    ) {
      return [];
    }
    const patterns = pattern instanceof RegExp ? [pattern] : pattern;
    const matchedPattern = patterns.find((candidate) => candidate.test(content));
    if (matchedPattern === undefined) return [];
    if (suppressWhen !== undefined && suppressWhen.test(content)) return [];
    const { line, column } = getMatchLocation(content, matchedPattern);
    return [{ message, line, column }];
  };
