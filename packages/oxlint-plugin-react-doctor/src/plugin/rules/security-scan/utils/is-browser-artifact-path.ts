import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Next.js (`.next`) and Nitro/Nuxt (`.output`) emit server-side build output
// under a `server/` segment that never reaches the browser. It can sit directly
// under the build root (`.next/server`) or nested under a mode directory in
// newer dev builds (`.next/dev/server`). The `.js.map` source maps for these
// server chunks bundle library source (node-rsa PEM markers, better-auth env
// helpers) that would otherwise read as a leaked secret (issues #816, #817).
// A segment walk finds a `server` directory at any depth below the build root
// without the polynomial backtracking a `(?:[^/]+\/)*server\/` regex incurs.
const SERVER_BUILD_ROOT_SEGMENTS = new Set([".next", ".output"]);
const SERVER_BUILD_OUTPUT_SEGMENT = "server";

const isServerOnlyBuildArtifactPath = (relativePath: string): boolean => {
  const segments = relativePath.split("/");
  const buildRootIndex = segments.findIndex((segment) => SERVER_BUILD_ROOT_SEGMENTS.has(segment));
  if (buildRootIndex === -1) return false;
  const serverSegmentIndex = segments.indexOf(SERVER_BUILD_OUTPUT_SEGMENT, buildRootIndex + 1);
  return serverSegmentIndex !== -1 && serverSegmentIndex < segments.length - 1;
};

export const isBrowserArtifactPath = (
  relativePath: string,
  isGeneratedBundle: boolean,
): boolean => {
  if (isServerOnlyBuildArtifactPath(relativePath)) return false;
  if (isGeneratedBundle) return true;
  if (relativePath.endsWith(".map")) return true;
  return BROWSER_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
};
