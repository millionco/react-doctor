import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// Cookie names that carry authentication/session identity. A leak of any of
// these to JavaScript (no HttpOnly) lets an XSS payload steal the session.
const AUTH_COOKIE_NAME =
  "session|sess|sid|connect\\.sid|auth|token|jwt|access[_-]?token|refresh[_-]?token|id[_-]?token";

// An auth-named cookie set: Express `res.cookie("session", …)`, next/headers
// `cookies().set("session", …)`, and the NextResponse `response.cookies.set(
// "session", …)` shape. Anchoring on the name keeps non-auth cookies (a
// theme/consent cookie that legitimately needs JS access) from tripping it.
const AUTH_COOKIE_SET_CALL = `(?:\\.cookies\\.set|cookies\\(\\s*\\)\\.set|\\.cookie)\\s*\\(\\s*[\`"'](?:${AUTH_COOKIE_NAME})[^\`"']*[\`"']`;

// An auth cookie set with `httpOnly: false` inside the same call.
const AUTH_COOKIE_HTTP_ONLY_DISABLED_PATTERN = new RegExp(
  `${AUTH_COOKIE_SET_CALL}[\\s\\S]{0,200}?httpOnly\\s*:\\s*false`,
  "i",
);

// An auth cookie set with no options object at all (the trailing `)` right
// after the value, no comma) — Express and Next default HttpOnly off.
const AUTH_COOKIE_NO_OPTIONS_PATTERN = new RegExp(`${AUTH_COOKIE_SET_CALL}\\s*,\\s*[^,]+\\)`, "i");

// Session-middleware cookie config block disabling HttpOnly
// (`session({ cookie: { httpOnly: false } })`).
const COOKIE_CONFIG_HTTP_ONLY_DISABLED_PATTERN = /cookie\s*:\s*\{[^}]*httpOnly\s*:\s*false/i;

// `document.cookie = "session=..."` — a cookie set from client JS can never be
// HttpOnly, so an auth/session cookie written this way is XSS-readable.
const CLIENT_AUTH_COOKIE_WRITE_PATTERN = new RegExp(
  `document\\.cookie\\s*=\\s*[\`"'][^\`"'=;]*(?:${AUTH_COOKIE_NAME})[^\`"'=;]*=`,
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
      AUTH_COOKIE_HTTP_ONLY_DISABLED_PATTERN,
      AUTH_COOKIE_NO_OPTIONS_PATTERN,
      COOKIE_CONFIG_HTTP_ONLY_DISABLED_PATTERN,
      CLIENT_AUTH_COOKIE_WRITE_PATTERN,
    ],
    message:
      "An auth/session cookie is exposed to JavaScript (set via document.cookie, with httpOnly: false, or without cookie options), letting an XSS payload steal it.",
  }),
});
