import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// A secret-shaped env var with a hardcoded string fallback
// (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`). Two bugs at once: the
// literal is a committed secret, and the app silently uses it (fails open)
// when the env var is unset. The env-name lookahead skips only names that are
// public BY CONSTRUCTION: a leading framework public prefix (`NEXT_PUBLIC_`/
// `EXPO_PUBLIC_`/`GATSBY_PUBLIC_`/`NUXT_PUBLIC_`/`REACT_APP_PUBLIC_`/
// `VITE_PUBLIC_`/bare `PUBLIC_`) or a publishable/anon key naming convention
// (`…PUBLISHABLE_KEY`/`…ANON_KEY`). A PUBLIC segment elsewhere in the name
// (`INTERNAL_PUBLIC_WEBHOOK_SECRET`) does not make the value public, and a
// name ending in `_SECRET`/`_PRIVATE_KEY`/`_PASSWORD`/`_PASSWD` is never
// exempt even under a public prefix — that fallback is a committed secret
// either way. The trailing negative lookbehind skips names that only
// REFERENCE a secret rather than hold one — `_HEADER`/`_NAME`/`_ID`/
// `_ENDPOINT`/`_URL`/… suffixes (e.g. `AUTH_TOKEN_HEADER`, `AWS_ACCESS_KEY_ID`,
// `TOKEN_ENDPOINT`), whose values are header names, key ids, or URLs, not
// secrets. The value lookahead skips placeholder defaults and URL values so
// only substantive secret literals flag.
// `(?![0-9]+["'`])` skips a purely numeric default — a duration/size config
// like `SESSION_TOKEN_TIMEOUT ?? "18000000"` (a millisecond count) is never a
// credential, even though the name carries `TOKEN`.
// Two more placeholder shapes: a snake_case literal ENDING in a secret word
// (`"cboard_client_token"`) is a name-like dummy, not a credential value, and
// a run of 8+ zeros after a short prefix (`"sk_0000000000000000000"`) is a
// zero-filled placeholder key. The standard Anvil/Hardhat test mnemonic is
// public fixture data rather than a credential.
const HARDCODED_SECRET_FALLBACK_PATTERN =
  /\bprocess\.env\.(?!(?:(?:(?:NEXT|EXPO|GATSBY|NUXT|REACT_APP|VITE)_)?PUBLIC_[A-Z0-9_]*(?<!_SECRET)(?<!_PRIVATE_KEY)(?<!_PASSWORD)(?<!_PASSWD)|[A-Z0-9_]*(?:PUBLISHABLE|ANON)_KEY)(?![A-Z0-9_]))[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_?KEY|APIKEY|ACCESS_KEY|CLIENT_SECRET|CREDENTIAL|SIGNING_KEY|ENCRYPTION_KEY|WEBHOOK_SECRET|SERVICE_ROLE)[A-Z0-9_]*(?<!_(?:NAME|HEADER|ENDPOINT|URL|URI|ID|PREFIX|SUFFIX|PARAM|PARAMS|FIELD|ISSUER|AUDIENCE|ALGORITHM|ALG|REGION|BUCKET|HOST|HOSTNAME|PORT|PATH|VERSION|SCOPE|TYPE|FORMAT|EXPIRY|TTL))\s*(?:\?\?|\|\|)\s*(["'`])(?![0-9]+["'`])(?![a-z][a-z0-9]*(?:[_-][a-z0-9]+)*[_-](?:token|secret|key|password|passwd|credential)s?["'`])(?![\w-]{0,12}0{8,}["'`])(?!test test test test test test test test test test test junk["'`])(?!(?:changeme|change[_-]?me|placeholder|your[_-]|example|sample|dummy|development|local|todo|replace[_-]?me|https?:\/\/|x{3,}|\*{3,}))[^"'`\n]{8,}\1/i;

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
