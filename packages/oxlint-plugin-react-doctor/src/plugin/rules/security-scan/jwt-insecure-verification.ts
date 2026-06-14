import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
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

// The allowlist is often passed as a separate options object/variable, so the
// gate is file-level: a file that names `algorithms` anywhere is treated as
// pinning it (favours precision over catching a mixed pinned/unpinned file).
const ALGORITHM_ALLOWLIST_PATTERN = /\balgorithms\b/i;

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

    if (!ALGORITHM_ALLOWLIST_PATTERN.test(content)) {
      JWT_VERIFY_PATTERN.lastIndex = 0;
      for (
        let verifyMatch = JWT_VERIFY_PATTERN.exec(content);
        verifyMatch !== null;
        verifyMatch = JWT_VERIFY_PATTERN.exec(content)
      ) {
        const location = getLocationAtIndex(content, verifyMatch.index);
        findings.push({
          message:
            "jwt.verify() has no `algorithms` allowlist, enabling RS256→HS256 algorithm-confusion forgery with the public key.",
          line: location.line,
          column: location.column,
        });
      }
    }

    return findings;
  },
});
