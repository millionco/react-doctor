import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Next.js (`.next`) and Nitro/Nuxt (`.output`) emit build trees that never
// reach end users in production, so they are not "browser artifacts":
//   - a `server/` directory at ANY depth below the build root (`.next/server`,
//     `.next/dev/server`, `.next/standalone/.next/server`, `.output/server`) —
//     its `.js.map` source maps bundle library source (PEM markers, env
//     helpers) that would otherwise read as a leaked secret (#816, #817);
//   - the dev server's entire transient output (`.next/dev/**`, written by
//     `next dev`), which is never deployed.
// Production browser bundles live in `.next/static`, `.output/public`,
// `dist/assets`, `public/`, etc. and are still scanned.
//
// A segment walk (not a regex) is used on purpose: an equivalent
// `(?:[^/]+\/)*server` pattern is polynomial on uncontrolled path strings
// (CodeQL flags it), whereas splitting on `/` and indexing is linear.
const SERVER_BUILD_ROOT_SEGMENTS = new Set([".next", ".output"]);

const isNonShippedBuildArtifactPath = (relativePath: string): boolean => {
  const segments = relativePath.split("/");
  const buildRootIndex = segments.findIndex((segment) => SERVER_BUILD_ROOT_SEGMENTS.has(segment));
  if (buildRootIndex === -1) return false;
  if (segments[buildRootIndex] === ".next" && segments[buildRootIndex + 1] === "dev") return true;
  // A `server` directory (not a file literally named `server`) anywhere below
  // the build root: it must have at least one path segment after it.
  const serverSegmentIndex = segments.indexOf("server", buildRootIndex + 1);
  return serverSegmentIndex !== -1 && serverSegmentIndex < segments.length - 1;
};

export const isBrowserArtifactPath = (
  relativePath: string,
  isGeneratedBundle: boolean,
): boolean => {
  if (isNonShippedBuildArtifactPath(relativePath)) return false;
  if (isGeneratedBundle) return true;
  if (relativePath.endsWith(".map")) return true;
  return BROWSER_ARTIFACT_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
};
