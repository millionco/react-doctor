import { DOCUMENTATION_CONTEXT_PATTERN } from "../../../constants/security-scan.js";
import type { ScanFinding, ScannedFile } from "../../../utils/file-scan.js";
import { getMatchLocation } from "./get-match-location.js";
import { isBrowserArtifactPath } from "./is-browser-artifact-path.js";

// Shared by `artifact-secret-leak` and `artifact-env-leak`: both gate on
// the same browser-artifact path test and report one finding at the first
// match of whatever leak pattern the rule detects in the content.
// Generated API-reference markdown can carry single lines long enough to
// trip the bundle sniffer, but documentation is not a shipped artifact.
export const scanArtifactLeak = (
  file: ScannedFile,
  findLeakPattern: (content: string) => RegExp | undefined,
  message: string,
): ScanFinding[] => {
  if (DOCUMENTATION_CONTEXT_PATTERN.test(file.relativePath)) return [];
  if (!isBrowserArtifactPath(file.relativePath, file.isGeneratedBundle)) return [];
  const leakPattern = findLeakPattern(file.content);
  if (leakPattern === undefined) return [];
  const location = getMatchLocation(file.content, leakPattern);
  return [{ message, line: location.line, column: location.column }];
};
