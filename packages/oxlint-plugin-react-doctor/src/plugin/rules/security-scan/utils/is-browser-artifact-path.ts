import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Next.js (`.next`) and Nitro/Nuxt (`.output`) emit server-side build output
// under a `server/` segment that never reaches the browser. It can sit
// directly under the build root (`.next/server`, `.output/server`) or nested
// under a mode directory in newer dev builds (`.next/dev/server`), so allow
// intermediate segments before `server/`. The `.js.map` source maps for these
// server chunks bundle library source (node-rsa PEM markers, better-auth env
// helpers) that would otherwise read as a leaked secret (issues #816, #817).
const SERVER_ONLY_BUILD_ARTIFACT_PATTERN = /(?:^|\/)(?:\.next|\.output)\/(?:[^/]+\/)*server\//;

const isServerOnlyBuildArtifactPath = (relativePath: string): boolean =>
  SERVER_ONLY_BUILD_ARTIFACT_PATTERN.test(relativePath);

export const isBrowserArtifactPath = (
  relativePath: string,
  isGeneratedBundle: boolean,
): boolean => {
  if (isServerOnlyBuildArtifactPath(relativePath)) return false;
  if (isGeneratedBundle) return true;
  if (relativePath.endsWith(".map")) return true;
  return BROWSER_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
};
