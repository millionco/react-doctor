import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { findMatchingParenIndex } from "./utils/find-matching-paren-index.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { getScannableContent } from "./utils/scan-by-pattern.js";

// Cookie names that carry authentication/session identity. A leak of any of
// these to JavaScript (no HttpOnly) lets an XSS payload steal the session.
const AUTH_COOKIE_NAME =
  "session|sess|sid|connect\\.sid|auth|token|jwt|access[_-]?token|refresh[_-]?token|id[_-]?token";

// An auth-named cookie set: Express `res.cookie("session", …)`, next/headers
// `cookies().set("session", …)`, and the NextResponse `response.cookies.set(
// "session", …)` shape. Anchoring on the name keeps non-auth cookies (a
// theme/consent cookie that legitimately needs JS access) from tripping it.
const AUTH_COOKIE_SET_CALL_PATTERN = new RegExp(
  `(?:\\.cookies\\.set|cookies\\(\\s*\\)\\.set|\\.cookie)\\s*\\(\\s*[\`"'](?:${AUTH_COOKIE_NAME})[^\`"']*[\`"']`,
  "gi",
);

const HTTP_ONLY_DISABLED_PATTERN = /httpOnly\s*:\s*false\b/i;

// Session-middleware cookie config disabling HttpOnly
// (`session({ cookie: { httpOnly: false } })`). `httpOnly` is cookie-specific,
// so a `cookie:` block setting it false is always a real cookie misconfig.
const COOKIE_CONFIG_HTTP_ONLY_DISABLED_PATTERN = /cookie\s*:\s*\{[^}]*httpOnly\s*:\s*false/gi;

// `document.cookie = "session=..."` — a cookie set from client JS can never be
// HttpOnly, so an auth/session cookie written this way is XSS-readable.
const CLIENT_AUTH_COOKIE_WRITE_PATTERN = new RegExp(
  `document\\.cookie\\s*=\\s*[\`"'][^\`"'=;]*(?:${AUTH_COOKIE_NAME})[^\`"'=;]*=`,
  "gi",
);

// Number of top-level (comma-separated, nesting-aware) arguments in a call's
// argument source — used to tell "no options object" (name + value only) from
// a call that passes cookie options.
const countTopLevelArguments = (argumentsSource: string): number => {
  if (argumentsSource.trim().length === 0) return 0;
  let depth = 0;
  let stringDelimiter: string | null = null;
  let count = 1;
  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index];
    if (stringDelimiter !== null) {
      if (character === "\\") index += 1;
      else if (character === stringDelimiter) stringDelimiter = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") stringDelimiter = character;
    else if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    else if (character === "," && depth === 0) count += 1;
  }
  return count;
};

const addMatchFindings = (
  content: string,
  pattern: RegExp,
  message: string,
  isInsecure: (matchIndex: number, matchText: string) => boolean,
  findings: ScanFinding[],
): void => {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    if (!isInsecure(match.index, match[0])) continue;
    const location = getLocationAtIndex(content, match.index);
    findings.push({ message, line: location.line, column: location.column });
  }
};

export const insecureSessionCookie = defineRule({
  id: "insecure-session-cookie",
  title: "Auth cookie missing HttpOnly protection",
  severity: "warn",
  recommendation:
    "Set auth/session cookies server-side with `httpOnly: true`, `secure: true`, and `sameSite`. Cookies set via `document.cookie` or with `httpOnly: false` are readable by any XSS payload and can be stolen.",
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    const content = getScannableContent(file);
    if (!/cookie/i.test(content)) return [];

    const findings: ScanFinding[] = [];
    const message =
      "An auth/session cookie is exposed to JavaScript (set via document.cookie, with httpOnly: false, or without cookie options), letting an XSS payload steal it.";

    // An auth cookie set is insecure when it has no options object (name +
    // value only) or its options explicitly disable httpOnly. Reading the whole
    // balanced call avoids missing an `httpOnly: false` deep in a long options
    // object.
    AUTH_COOKIE_SET_CALL_PATTERN.lastIndex = 0;
    for (
      let match = AUTH_COOKIE_SET_CALL_PATTERN.exec(content);
      match !== null;
      match = AUTH_COOKIE_SET_CALL_PATTERN.exec(content)
    ) {
      const openParenIndex = content.indexOf("(", match.index);
      const closeParenIndex = findMatchingParenIndex(content, openParenIndex);
      const argumentsSource =
        closeParenIndex >= 0 ? content.slice(openParenIndex + 1, closeParenIndex) : "";
      const hasNoOptions = countTopLevelArguments(argumentsSource) < 3;
      if (!hasNoOptions && !HTTP_ONLY_DISABLED_PATTERN.test(argumentsSource)) continue;
      const location = getLocationAtIndex(content, match.index);
      findings.push({ message, line: location.line, column: location.column });
    }

    addMatchFindings(
      content,
      COOKIE_CONFIG_HTTP_ONLY_DISABLED_PATTERN,
      message,
      () => true,
      findings,
    );
    addMatchFindings(content, CLIENT_AUTH_COOKIE_WRITE_PATTERN, message, () => true, findings);

    return findings;
  },
});
