import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { getMatchLocation } from "./utils/get-match-location.js";
import { isBrowserArtifactPath } from "./utils/is-browser-artifact-path.js";
import { isConfigOrCiPath } from "./utils/is-config-or-ci-path.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

const SVG_ACTIVE_PATTERN = /<script\b|on(?:load|error|click|mouseover)\s*=/i;

const DANGEROUS_ALLOW_SVG_PATTERN = /dangerouslyAllowSVG\s*:\s*true/i;

const EXECUTABLE_SVG_EMBED_PATTERN =
  /<(?:object|embed|iframe)\b[^>]+(?:data|src)=["'][^"']+\.svg(?:\?[^"']*)?["']/i;

export const activeStaticAsset = defineRule({
  id: "active-static-asset",
  title: "Executable SVG exposure",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Prefer `<img>` for SVG images; if SVG must be served directly, use attachment disposition and a CSP that blocks scripts and objects.",
  scan: (file) => {
    const findings: ScanFinding[] = [];

    if (
      file.relativePath.endsWith(".svg") &&
      isBrowserArtifactPath(file.relativePath, file.isGeneratedBundle)
    ) {
      if (SVG_ACTIVE_PATTERN.test(file.content)) {
        const location = getMatchLocation(file.content, SVG_ACTIVE_PATTERN);
        // The active-SVG variant escalates past the rule's default metadata;
        // splitting it into its own rule id is a tracked follow-up.
        findings.push({
          message: "A browser-reachable SVG contains script or event-handler code.",
          line: location.line,
          column: location.column,
          severity: "error",
          title: "Active SVG in public assets",
          help: "Serve untrusted SVG as downloads, sanitize it, or isolate it on a cookieless asset origin with a restrictive CSP.",
        });
      }
      return findings;
    }

    if (!isProductionSourcePath(file.relativePath) && !isConfigOrCiPath(file.relativePath)) {
      return findings;
    }

    const pattern = [DANGEROUS_ALLOW_SVG_PATTERN, EXECUTABLE_SVG_EMBED_PATTERN].find((candidate) =>
      candidate.test(file.content),
    );
    if (pattern !== undefined) {
      const location = getMatchLocation(file.content, pattern);
      findings.push({
        message: "The app enables or embeds SVG in an executable browser context.",
        line: location.line,
        column: location.column,
      });
    }

    return findings;
  },
});
