import type { AstCheck, ScanFinding } from "../types/index.js";
import { offsetToLine } from "../utils/offset-to-line.js";

const TS_SUPPRESSION_PATTERN = /@ts-(ignore|nocheck|expect-error)\b/;

// Flags `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` directives. These
// silence the compiler wholesale and are the most severe TypeScript escape
// hatch, so they are scored as errors. Works on the comment stream rather than
// the AST (directives are comments, not nodes).
export const tsBanTsComment: AstCheck = (file): ScanFinding[] =>
  file.comments
    .filter((comment) => TS_SUPPRESSION_PATTERN.test(comment.value))
    .map((comment) => ({
      scanner: "typescript",
      dimension: "ts-strictness",
      ruleId: "ts/ban-ts-comment",
      severity: "error",
      filePath: file.filePath,
      line: offsetToLine(file.sourceText, comment.start),
      message: "TypeScript suppression directive hides real type errors; fix the underlying type.",
    }));
