import { SECRET_VALUE_PATTERNS } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { isPublicDebugArtifactPath } from "./utils/is-public-debug-artifact-path.js";

export const publicDebugArtifact = defineRule({
  id: "public-debug-artifact",
  title: "Public debug artifact",
  severity: "warn",
  impact: "security",
  confidence: "heuristic",
  fix: "local",
  recommendation:
    "Remove debug artifacts from public output; logs and dumps often reveal source paths, internal routes, tokens, or environment snapshots.",
  scan: (file) => {
    if (!isPublicDebugArtifactPath(file.relativePath)) return [];
    // The finding is about the file existing at a public path, so there is
    // no content match to anchor to — whole-file findings sit at 1:1.
    const finding: ScanFinding = {
      message: "A browser-reachable debug, log, dump, report, or env artifact is present.",
      line: 1,
      column: 1,
    };
    // Secret-bearing debug artifacts escalate over the rule's default "warn".
    const hasSecretValue = SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(file.content));
    return [hasSecretValue ? { ...finding, severity: "error" } : finding];
  },
});
