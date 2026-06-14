import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// Cookie names that carry authentication/session identity. A leak of any of
// these to JavaScript (no HttpOnly) lets an XSS payload steal the session.
const AUTH_COOKIE_NAME =
  "session|sess|sid|connect\\.sid|auth|token|jwt|access[_-]?token|refresh[_-]?token|id[_-]?token";

// `httpOnly: false` on a cookie config — explicitly exposes the cookie to JS.
const HTTP_ONLY_DISABLED_PATTERN = /\bhttpOnly\s*:\s*false\b/i;

// `document.cookie = "session=..."` — a cookie set from client JS can never be
// HttpOnly, so an auth/session cookie written this way is XSS-readable.
const CLIENT_AUTH_COOKIE_WRITE_PATTERN = new RegExp(
  `document\\.cookie\\s*=\\s*[\`"'][^\`"']*\\b(?:${AUTH_COOKIE_NAME})\\b[^\`"']*=`,
  "i",
);

// `res.cookie("session", value)` / `cookies().set("session", value)` with no
// options object — Express and Next default HttpOnly off, so a bare auth-cookie
// set ships without the flag. The trailing `)` right after the value (no comma)
// confirms there is no options argument.
const SERVER_AUTH_COOKIE_NO_OPTIONS_PATTERN = new RegExp(
  `(?:\\b(?:res|reply|response)\\.cookie|cookies\\(\\s*\\)\\.set)\\s*\\(\\s*[\`"'](?:${AUTH_COOKIE_NAME})[^\`"']*[\`"']\\s*,\\s*[^,]+\\)`,
  "i",
);

export const insecureSessionCookie = defineRule({
  id: "insecure-session-cookie",
  title: "Auth cookie missing HttpOnly protection",
  severity: "warn",
  recommendation:
    "Set auth/session cookies server-side with `httpOnly: true`, `secure: true`, and `sameSite`. Cookies set via `document.cookie` or with `httpOnly: false` are readable by any XSS payload and can be stolen.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern: [
      HTTP_ONLY_DISABLED_PATTERN,
      CLIENT_AUTH_COOKIE_WRITE_PATTERN,
      SERVER_AUTH_COOKIE_NO_OPTIONS_PATTERN,
    ],
    message:
      "An auth/session cookie is exposed to JavaScript (set via document.cookie, with httpOnly: false, or without cookie options), letting an XSS payload steal it.",
  }),
});
