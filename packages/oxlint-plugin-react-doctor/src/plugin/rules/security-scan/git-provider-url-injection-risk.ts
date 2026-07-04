import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

const GIT_PROVIDER_HOST_PATTERN = /api\.github\.com|github\.com|gitlab\.com|bitbucket\.org/gi;

const TEMPLATE_INTERPOLATION_PATTERN = /\$\{([^}]*)\}/g;

// Interpolating internal constants (commit SHAs, version strings, issue
// links) into provider URLs is how everyone builds changelog/report-bug
// links — only flag when the interpolated value visibly reads external
// input. Bare identifiers named owner/repo/slug/branch are overwhelmingly
// internal config or function parameters, so the marker must be a
// request-shaped property access or an explicit untrusted/decode marker.
const EXTERNAL_INPUT_PATTERN =
  /\b(?:params|searchParams|query|req|request|input|payload)\s*[.[]|\buntrusted|\bdecodeURI\w*/;

const ENCODED_INTERPOLATION_PATTERN = /encodeURIComponent\s*\(/;

const INTERPOLATION_LOOKAHEAD_CHARS = 200;

export const gitProviderUrlInjectionRisk = defineRule({
  id: "git-provider-url-injection-risk",
  title: "Git provider URL built from interpolation",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Validate owner, repo, org, and branch identifiers against strict slugs and build URLs with URL/path encoders instead of raw interpolation.",
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];

    const findings: ScanFinding[] = [];
    for (const hostMatch of file.content.matchAll(GIT_PROVIDER_HOST_PATTERN)) {
      const rawTail = file.content.slice(
        hostMatch.index,
        hostMatch.index + INTERPOLATION_LOOKAHEAD_CHARS,
      );
      const templateEndIndex = rawTail.indexOf("`");
      const urlTail = templateEndIndex >= 0 ? rawTail.slice(0, templateEndIndex) : rawTail;
      const hasTaintedInterpolation = Array.from(
        urlTail.matchAll(TEMPLATE_INTERPOLATION_PATTERN),
      ).some(
        (interpolation) =>
          EXTERNAL_INPUT_PATTERN.test(interpolation[1] ?? "") &&
          !ENCODED_INTERPOLATION_PATTERN.test(interpolation[1] ?? ""),
      );
      if (!hasTaintedInterpolation) continue;

      const location = getLocationAtIndex(file.content, hostMatch.index);
      findings.push({
        message:
          "GitHub/GitLab/Bitbucket URL construction interpolates path components that may be attacker-controlled.",
        line: location.line,
        column: location.column,
      });
      break;
    }
    return findings;
  },
});
