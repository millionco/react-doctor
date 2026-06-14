import {
  DOCUMENTATION_CONTEXT_PATTERN,
  TEST_CONTEXT_PATTERN,
} from "../../constants/security-scan.js";
import { defineRule } from "../../utils/define-rule.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const keyLifecycleRisk = defineRule({
  id: "key-lifecycle-risk",
  title: "Long-lived key material in repository",
  severity: "error",
  committedFilesOnly: true,
  recommendation:
    "Remove private keys from source, rotate exposed credentials, prefer short-lived deploy credentials, and document revocation/expiry for release keys.",
  // A key-shaped env NAME is how CI correctly references a secret store —
  // only flag actual PEM material or a name assigned an inline literal value.
  // The PEM header must be followed by a base64 body: UI placeholders, header
  // constants, and `${...}`-wrapped headers are key-shaped text, not keys, and
  // a `...` ellipsis early in the body marks a truncated docs placeholder.
  // A placeholder/example/sample name binding right before the header marks a
  // throwaway key committed as UI filler, not live key material.
  scan: scanByPattern({
    shouldScan: (file) =>
      !TEST_CONTEXT_PATTERN.test(file.relativePath) &&
      !DOCUMENTATION_CONTEXT_PATTERN.test(file.relativePath),
    pattern:
      /(?<!(?:placeholder|example|sample|dummy|fake)[\s\S]{0,40})-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----(?:\s|\\r|\\n)*[A-Za-z0-9+/=][A-Za-z0-9+/=\s]{38,}(?![^-]{0,160}\.\.\.)|\b(?:SSH_PRIVATE_KEY|GPG_PRIVATE_KEY|DEPLOY_KEY|SIGNING_KEY)\b\s*[:=]\s*["'][^"'\n]{16,}["']/i,
    message: "Private or long-lived release key material appears in the repository.",
  }),
});
