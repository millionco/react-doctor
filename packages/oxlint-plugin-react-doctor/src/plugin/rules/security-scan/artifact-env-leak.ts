import {
  FULL_ENV_LEAK_CONTEXT_PATTERN,
  FULL_ENV_LEAK_COMMENT_TRIVIA_PATTERN,
  FULL_ENV_LEAK_SECRET_NAME_PATTERN,
} from "../../constants/security.js";
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
    let isRawCandidateExact = false;
    const findRawCandidatePattern = (content: string): RegExp | undefined => {
      const suspiciousPublicNamePattern = findSuspiciousPublicEnvSecretNamePattern(content);
      if (suspiciousPublicNamePattern) {
        isRawCandidateExact = true;
        return suspiciousPublicNamePattern;
      }
      if (!FULL_ENV_LEAK_SECRET_NAME_PATTERN.test(content)) return undefined;
      if (FULL_ENV_LEAK_CONTEXT_PATTERN.test(content)) {
        isRawCandidateExact = true;
        return FULL_ENV_LEAK_SECRET_NAME_PATTERN;
      }
      return FULL_ENV_LEAK_COMMENT_TRIVIA_PATTERN.test(content)
        ? FULL_ENV_LEAK_SECRET_NAME_PATTERN
        : undefined;
    };
    const rawCandidateFindings = scanArtifactLeak(
      file,
      findRawCandidatePattern,
      ARTIFACT_ENV_LEAK_MESSAGE,
    );
    if (rawCandidateFindings.length === 0) return rawCandidateFindings;

    const rawFindings = isRawCandidateExact
      ? rawCandidateFindings
      : scanArtifactLeak(file, findArtifactEnvLeakPattern, ARTIFACT_ENV_LEAK_MESSAGE);

    const executableContent = maskSourceComments(file.relativePath, file.content);
    if (executableContent === undefined) return rawCandidateFindings;
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
