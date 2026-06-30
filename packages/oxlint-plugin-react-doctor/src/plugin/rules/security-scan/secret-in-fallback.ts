import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// A secret-shaped env var with a hardcoded string fallback
// (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`). Two bugs at once: the
// literal is a committed secret, and the app silently uses it (fails open)
// when the env var is unset. The env-name lookahead skips intentionally-public
// vars (PUBLIC/PUBLISHABLE/ANON). The trailing negative lookbehind skips names
// that only REFERENCE a secret rather than hold one — `_HEADER`/`_NAME`/`_ID`/
// `_ENDPOINT`/`_URL`/… suffixes (e.g. `AUTH_TOKEN_HEADER`, `AWS_ACCESS_KEY_ID`,
// `TOKEN_ENDPOINT`), whose values are header names, key ids, or URLs, not
// secrets. The value lookahead skips placeholder defaults and URL values so
// only substantive secret literals flag.
// `(?![A-Z0-9])` (not `\b`) bounds the PUBLIC/PUBLISHABLE/ANON keyword so it
// matches a separator-delimited segment: `NEXT_PUBLIC_…`/`…_PUBLISHABLE_KEY`
// have a `_` (a word char) after the keyword, so `\b` never fired there and the
// supposedly-public var was flagged anyway.
// `(?![0-9]+["'`])` skips a purely numeric default — a duration/size config
// like `SESSION_TOKEN_TIMEOUT ?? "18000000"` (a millisecond count) is never a
// credential, even though the name carries `TOKEN`.
const HARDCODED_SECRET_FALLBACK_PATTERN =
  /\bprocess\.env\.(?![A-Z0-9_]*(?:PUBLIC|PUBLISHABLE|ANON)(?![A-Z0-9]))[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_?KEY|APIKEY|ACCESS_KEY|CLIENT_SECRET|CREDENTIAL|SIGNING_KEY|ENCRYPTION_KEY|WEBHOOK_SECRET|SERVICE_ROLE)[A-Z0-9_]*(?<!_(?:NAME|HEADER|ENDPOINT|URL|URI|ID|PREFIX|SUFFIX|PARAM|PARAMS|FIELD|ISSUER|AUDIENCE|ALGORITHM|ALG|REGION|BUCKET|HOST|HOSTNAME|PORT|PATH|VERSION|SCOPE|TYPE|FORMAT|EXPIRY|TTL))\s*(?:\?\?|\|\|)\s*(["'`])(?![0-9]+["'`])(?!(?:changeme|change[_-]?me|placeholder|your[_-]|example|sample|dummy|development|local|todo|replace[_-]?me|https?:\/\/|x{3,}|\*{3,}))[^"'`\n]{8,}\1/i;

export const secretInFallback = defineRule({
  id: "secret-in-fallback",
  title: "Hardcoded secret fallback for env var",
  severity: "error",
  recommendation:
    "Remove the literal fallback and fail closed (throw when the variable is unset). The hardcoded value is a committed secret, and the `??`/`||` default makes the app run with it in any environment that forgot to set the var.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern: HARDCODED_SECRET_FALLBACK_PATTERN,
    message:
      "A secret env var has a hardcoded string fallback: the literal is a committed secret and the app fails open (uses it) when the variable is unset.",
  }),
});
