import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// A secret-shaped env var with a hardcoded string fallback
// (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`). Two bugs at once: the
// literal is a committed secret, and the app silently uses it (fails open)
// when the env var is unset. The env-name lookahead skips intentionally-public
// vars (PUBLIC/PUBLISHABLE/ANON), and the value lookahead skips placeholder
// defaults so only substantive literals flag.
const HARDCODED_SECRET_FALLBACK_PATTERN =
  /\bprocess\.env\.(?![A-Z0-9_]*(?:PUBLIC|PUBLISHABLE|ANON)\b)[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_?KEY|APIKEY|ACCESS_KEY|CLIENT_SECRET|CREDENTIAL|SIGNING_KEY|ENCRYPTION_KEY|WEBHOOK_SECRET|SERVICE_ROLE)[A-Z0-9_]*\s*(?:\?\?|\|\|)\s*(["'`])(?!(?:changeme|change[_-]?me|placeholder|your[_-]|example|sample|dummy|development|local|todo|replace[_-]?me|x{3,}|\*{3,}))[^"'`\n]{8,}\1/i;

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
