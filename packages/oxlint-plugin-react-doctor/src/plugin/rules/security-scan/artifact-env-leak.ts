import { FULL_ENV_LEAK_SECRET_NAME_PATTERN } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSuspiciousPublicEnvSecretNamePattern } from "./utils/find-suspicious-public-env-secret-name.js";
import { hasFullEnvLeakShape } from "./utils/has-full-env-leak-shape.js";
import { maskSourceComments } from "./utils/mask-source-comments.js";
import { scanArtifactLeak } from "./utils/scan-artifact-leak.js";

const ARTIFACT_ENV_LEAK_MESSAGE =
  "A browser artifact contains server-secret environment names or a full environment dump shape.";

const findArtifactEnvLeakPattern = (content: string): RegExp | undefined =>
  findSuspiciousPublicEnvSecretNamePattern(content) ??
  (hasFullEnvLeakShape(content) ? FULL_ENV_LEAK_SECRET_NAME_PATTERN : undefined);

export const artifactEnvLeak = defineRule({
  id: "artifact-env-leak",
  title: "Server env leaked to browser artifact",
  severity: "error",
  recommendation:
    "Treat public env prefixes as publication, not secrecy; keep secret env vars server-only and rebuild after rotating leaked keys.",
  scan: (file) => {
    const rawFindings = scanArtifactLeak(
      file,
      findArtifactEnvLeakPattern,
      ARTIFACT_ENV_LEAK_MESSAGE,
    );
    if (rawFindings.length === 0) return rawFindings;

    const executableContent = maskSourceComments(file.relativePath, file.content);
    if (executableContent === file.content) return rawFindings;

    return scanArtifactLeak(
      {
        ...file,
        content: executableContent,
      },
      findArtifactEnvLeakPattern,
      ARTIFACT_ENV_LEAK_MESSAGE,
    );
  },
});
