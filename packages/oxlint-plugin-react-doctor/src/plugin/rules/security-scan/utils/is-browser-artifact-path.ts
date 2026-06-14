import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Build output that never reaches end users in production, so it is not a
// "browser artifact": server build output (`.next/server`, `.next/dev/server`,
// `.output/server`) and the dev server's transient output (`.next/dev/**`,
// which Next.js Turbopack writes during `next dev`). Production browser bundles
// live in `.next/static`, `.output/public`, `dist/assets`, `public/`, etc.
const isNonShippedBuildArtifactPath = (relativePath: string): boolean =>
  /(?:^|\/)(?:\.next\/(?:[^/]+\/)?server|\.output\/server)\//.test(relativePath) ||
  /(?:^|\/)\.next\/dev\//.test(relativePath);

export const isBrowserArtifactPath = (
  relativePath: string,
  isGeneratedBundle: boolean,
): boolean => {
  if (isNonShippedBuildArtifactPath(relativePath)) return false;
  if (isGeneratedBundle) return true;
  if (relativePath.endsWith(".map")) return true;
  return BROWSER_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
};
