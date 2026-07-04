import { SECRET_VALUE_PATTERNS } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { scanArtifactLeak } from "./utils/scan-artifact-leak.js";

export const artifactSecretLeak = defineRule({
  id: "artifact-secret-leak",
  title: "Secret shipped in browser artifact",
  severity: "error",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Remove the secret from client bundles/static assets, rotate it, and route privileged service calls through server-only code.",
  scan: (file) =>
    scanArtifactLeak(
      file,
      (content) => SECRET_VALUE_PATTERNS.find((pattern) => pattern.test(content)),
      "A browser-delivered artifact contains a secret-looking credential value.",
    ),
});
