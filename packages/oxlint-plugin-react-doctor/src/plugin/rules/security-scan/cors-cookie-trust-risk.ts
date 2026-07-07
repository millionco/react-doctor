import { defineRule } from "../../utils/define-rule.js";
import { isConfigOrCiPath } from "./utils/is-config-or-ci-path.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const corsCookieTrustRisk = defineRule({
  id: "cors-cookie-trust-risk",
  title: "Broad cookie or credentialed CORS trust",
  severity: "warn",
  recommendation:
    "Keep auth cookies host-only and HttpOnly, avoid credentialed CORS for less-trusted docs/vendor origins, and isolate documentation domains from app sessions.",
  scan: scanByPattern({
    shouldScan: (file) =>
      isProductionSourcePath(file.relativePath) || isConfigOrCiPath(file.relativePath),
    // The cookie branch must cross the `=value;` that always follows a cookie
    // name in a Set-Cookie string (`session=abc; Domain=.example.com`); a bare
    // `[^=\n]` run from the name can never reach `Domain=.`.
    pattern:
      /Access-Control-Allow-Credentials["']?\s*[:,]\s*["']?true[\s\S]{0,700}Access-Control-Allow-Origin["']?\s*[:,]\s*["']?(?:\*|https:\/\/docs\.|https:\/\/.*mintlify)|\b(?:session|auth|token|jwt)[^=\n]{0,80}(?:=[^;\n]{0,120};[^=\n]{0,80})?\bDomain=\./i,
    message:
      "Credentialed CORS or broad auth-cookie scope can make a docs/custom-domain XSS become account compromise.",
  }),
});
