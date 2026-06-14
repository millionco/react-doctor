import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { escapeRegExp } from "./utils/escape-reg-exp.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { getScannableContent } from "./utils/scan-by-pattern.js";

// `alg: none` / `algorithms: ["none"]` disables signature verification — any
// attacker-forged token is accepted. Always critical, never legitimate.
const NONE_ALGORITHM_PATTERN = /\balgorithms?\s*:\s*\[?\s*["'`]none["'`]/gi;

// `jwt.verify(...)` (jsonwebtoken) with no `algorithms` allowlist: when the key
// is asymmetric (RS256), an attacker re-signs with HS256 using the public key
// as the HMAC secret — algorithm-confusion forgery. The allowlist is the fix.
const JWT_VERIFY_PATTERN = /\b(?:jwt|jsonwebtoken)\s*\.\s*verify\s*\(/gi;

const ALGORITHMS_KEY_PATTERN = /\balgorithms\b/i;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const OPTIONS_OBJECT_SCAN_CHARS = 400;

// Return the source between the call's parentheses, balanced so a nested
// `getKey()` or `{ ... }` does not end the slice early. Falls back to a fixed
// window if the parens never balance (truncated/odd source).
const extractBalancedArguments = (content: string, openParenIndex: number): string => {
  let depth = 0;
  for (let index = openParenIndex; index < content.length; index += 1) {
    const character = content[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return content.slice(openParenIndex + 1, index);
    }
  }
  return content.slice(openParenIndex + 1, openParenIndex + 1 + OPTIONS_OBJECT_SCAN_CHARS);
};

// Split call arguments on top-level commas only (ignoring commas inside
// nested (), [], {}, and string literals) so the options argument can be read.
const splitTopLevelArguments = (argumentsText: string): string[] => {
  const argumentList: string[] = [];
  let depth = 0;
  let stringDelimiter: string | null = null;
  let currentArgument = "";
  for (let index = 0; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (stringDelimiter !== null) {
      currentArgument += character;
      if (character === "\\") {
        currentArgument += argumentsText[index + 1] ?? "";
        index += 1;
      } else if (character === stringDelimiter) {
        stringDelimiter = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      stringDelimiter = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      argumentList.push(currentArgument.trim());
      currentArgument = "";
      continue;
    }
    currentArgument += character;
  }
  if (currentArgument.trim().length > 0) argumentList.push(currentArgument.trim());
  return argumentList;
};

// Does this specific verify call pin an algorithms allowlist? True when the
// options are inline (`{ algorithms: [...] }`), when the options variable
// resolves to an object literal naming `algorithms`, or when the options are
// an unresolvable expression (a call / import) we must not flag on guesswork.
const verifyCallPinsAlgorithms = (argumentsText: string, content: string): boolean => {
  if (ALGORITHMS_KEY_PATTERN.test(argumentsText)) return true;
  const optionsArgument = splitTopLevelArguments(argumentsText)[2];
  if (optionsArgument === undefined) return false;
  if (IDENTIFIER_PATTERN.test(optionsArgument)) {
    const assignedObject = new RegExp(
      `\\b${escapeRegExp(optionsArgument)}\\b\\s*[=:]\\s*\\{([\\s\\S]{0,${OPTIONS_OBJECT_SCAN_CHARS}}?)\\}`,
    ).exec(content);
    if (assignedObject === null) return true;
    return ALGORITHMS_KEY_PATTERN.test(assignedObject[1] ?? "");
  }
  // An inline object without `algorithms` is unpinned; any other expression
  // (a factory call, spread) is unresolvable, so stay quiet to avoid guessing.
  return !optionsArgument.startsWith("{");
};

export const jwtInsecureVerification = defineRule({
  id: "jwt-insecure-verification",
  title: "Insecure JWT verification",
  severity: "warn",
  recommendation:
    "Pin accepted algorithms (`jwt.verify(token, key, { algorithms: ['RS256'] })`), never accept `none`, and keep signing keys in env vars. An unpinned verify allows RS256→HS256 algorithm-confusion forgery.",
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    const content = getScannableContent(file);
    if (!/\bjwt\b|jsonwebtoken/i.test(content)) return [];

    const findings: ScanFinding[] = [];

    NONE_ALGORITHM_PATTERN.lastIndex = 0;
    for (
      let noneMatch = NONE_ALGORITHM_PATTERN.exec(content);
      noneMatch !== null;
      noneMatch = NONE_ALGORITHM_PATTERN.exec(content)
    ) {
      const location = getLocationAtIndex(content, noneMatch.index);
      findings.push({
        message:
          "JWT is configured with the 'none' algorithm, which disables signature verification, so any forged token is accepted.",
        line: location.line,
        column: location.column,
        severity: "error",
      });
    }

    JWT_VERIFY_PATTERN.lastIndex = 0;
    for (
      let verifyMatch = JWT_VERIFY_PATTERN.exec(content);
      verifyMatch !== null;
      verifyMatch = JWT_VERIFY_PATTERN.exec(content)
    ) {
      const openParenIndex = verifyMatch.index + verifyMatch[0].length - 1;
      const argumentsText = extractBalancedArguments(content, openParenIndex);
      if (verifyCallPinsAlgorithms(argumentsText, content)) continue;
      const location = getLocationAtIndex(content, verifyMatch.index);
      findings.push({
        message:
          "jwt.verify() has no `algorithms` allowlist, enabling RS256→HS256 algorithm-confusion forgery with the public key.",
        line: location.line,
        column: location.column,
      });
    }

    return findings;
  },
});
