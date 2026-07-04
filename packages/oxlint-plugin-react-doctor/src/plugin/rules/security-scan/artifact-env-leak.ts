import { FULL_ENV_LEAK_SECRET_NAME_PATTERN } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSuspiciousPublicEnvSecretNamePattern } from "./utils/find-suspicious-public-env-secret-name.js";
import { hasFullEnvLeakShape } from "./utils/has-full-env-leak-shape.js";
import { scanArtifactLeak } from "./utils/scan-artifact-leak.js";

export const artifactEnvLeak = defineRule({
  id: "artifact-env-leak",
  title: "Server env leaked to browser artifact",
  severity: "error",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Treat public env prefixes as publication, not secrecy; keep secret env vars server-only and rebuild after rotating leaked keys.",
  scan: (file) =>
    scanArtifactLeak(
      file,
      (content) =>
        findSuspiciousPublicEnvSecretNamePattern(content) ??
        (hasFullEnvLeakShape(content) ? FULL_ENV_LEAK_SECRET_NAME_PATTERN : undefined),
      "A browser artifact contains server-secret environment names or a full environment dump shape.",
    ),
});
