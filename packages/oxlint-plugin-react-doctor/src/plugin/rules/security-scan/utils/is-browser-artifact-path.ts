import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Build output that never reaches end users in production, so it is not a
// "browser artifact": any `.next/**/server` (e.g. `.next/server`,
// `.next/dev/server`, `.next/standalone/.next/server`) and `.output/server`
// server build output, plus the dev server's transient output (`.next/dev/**`,
// which Next.js Turbopack writes during `next dev`). Production browser bundles
// live in `.next/static`, `.output/public`, `dist/assets`, `public/`, etc.
// `(?:[^/]+\/)*server` matches `server` at any depth and is ReDoS-safe (each
// repeated segment must consume a `/`, so there is no ambiguous overlap).
const isNonShippedBuildArtifactPath = (relativePath: string): boolean =>
  /(?:^|\/)(?:\.next\/(?:[^/]+\/)*server|\.output\/server)\//.test(relativePath) ||
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
