import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { getScannableContent } from "./utils/scan-by-pattern.js";

// `alg: none` / `algorithms: ["none"]` disables signature verification — any
// attacker-forged token is accepted. This is the one unambiguous,
// text-detectable JWT misconfiguration. Detecting an *unpinned* `jwt.verify`
// (missing `algorithms` allowlist → RS256→HS256 confusion) precisely requires
// scope-aware resolution of the options argument/binding (variable vs inline
// vs callback, import scope, TS annotations), which a regex scan cannot do
// without false positives/negatives — that is deferred to a future AST rule.
const NONE_ALGORITHM_PATTERN = /\b(?:alg|algorithms?)\s*:\s*\[?\s*["'`]none["'`]/gi;

// True when `index` falls inside a string/template literal — used to skip an
// `algorithm: "none"` mentioned in error text or docs (`"never use algorithm:
// 'none'"`) rather than a real options object. Template `${…}` interpolations
// are treated as code, so a real `alg: "none"` inside one is NOT skipped.
const isIndexInsideStringLiteral = (content: string, index: number): boolean => {
  let stringDelimiter: string | null = null;
  // Brace depth of each open `${…}` expression nested inside template strings.
  const templateExpressionDepths: number[] = [];
  for (let cursor = 0; cursor < index; cursor += 1) {
    const character = content[cursor];
    if (stringDelimiter === "`") {
      if (character === "\\") {
        cursor += 1;
      } else if (character === "`") {
        stringDelimiter = null;
      } else if (character === "$" && content[cursor + 1] === "{") {
        templateExpressionDepths.push(0);
        stringDelimiter = null;
        cursor += 1;
      }
      continue;
    }
    if (stringDelimiter !== null) {
      if (character === "\\") {
        cursor += 1;
      } else if (character === stringDelimiter) {
        stringDelimiter = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
    } else if (templateExpressionDepths.length > 0) {
      const top = templateExpressionDepths.length - 1;
      if (character === "{") {
        templateExpressionDepths[top] += 1;
      } else if (character === "}") {
        if (templateExpressionDepths[top] === 0) {
          templateExpressionDepths.pop();
          stringDelimiter = "`";
        } else {
          templateExpressionDepths[top] -= 1;
        }
      }
    }
  }
  return stringDelimiter !== null;
};

export const jwtInsecureVerification = defineRule({
  id: "jwt-insecure-verification",
  title: "JWT verified with the 'none' algorithm",
  severity: "error",
  recommendation:
    "Never accept the `none` algorithm; it disables signature verification and lets any forged token through. Pin the real algorithm(s) explicitly (`jwt.verify(token, key, { algorithms: ['RS256'] })`).",
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    const content = getScannableContent(file);
    if (!/\bjwt\b|jsonwebtoken|\bjose\b/i.test(content)) return [];

    const findings: ScanFinding[] = [];
    NONE_ALGORITHM_PATTERN.lastIndex = 0;
    for (
      let noneMatch = NONE_ALGORITHM_PATTERN.exec(content);
      noneMatch !== null;
      noneMatch = NONE_ALGORITHM_PATTERN.exec(content)
    ) {
      if (isIndexInsideStringLiteral(content, noneMatch.index)) continue;
      const location = getLocationAtIndex(content, noneMatch.index);
      findings.push({
        message:
          "JWT is configured with the 'none' algorithm, which disables signature verification, so any forged token is accepted.",
        line: location.line,
        column: location.column,
      });
    }
    return findings;
  },
});
