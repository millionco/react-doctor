import { BROWSER_ARTIFACT_PATH_PATTERNS } from "../../../constants/security-scan.js";

// Next.js (`.next`) and Nitro/Nuxt (`.output`) emit build trees that never
// reach end users in production, so they are not "browser artifacts":
//   - a `server/` directory DIRECTLY under a build root — `.next/server`,
//     `.output/server`, and the standalone `.next/standalone/.next/server`.
//     Its `.js.map` source maps bundle library source (PEM markers, env
//     helpers) that would otherwise read as a leaked secret (#816, #817).
//     `server` must sit directly under the root: a `server` folder nested
//     elsewhere (e.g. a `.next/static/.../server` App Router route bundle) is
//     still production browser output and MUST keep being scanned.
//   - the dev server's entire transient output (`.next/dev/**`, written by
//     `next dev`), which is never deployed — this also covers the dev server
//     build at `.next/dev/server`.
// Production browser bundles live in `.next/static`, `.output/public`,
// `dist/assets`, `public/`, etc. and are still scanned.
//
// A segment walk (not a regex) is used on purpose: an equivalent
// `(?:[^/]+\/)*server` pattern is polynomial on uncontrolled path strings
// (CodeQL flags it), whereas splitting on `/` and indexing is linear.
const SERVER_BUILD_ROOT_SEGMENTS = new Set([".next", ".output"]);

const isNonShippedBuildArtifactPath = (relativePath: string): boolean => {
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (!SERVER_BUILD_ROOT_SEGMENTS.has(segments[index])) continue;
    // `.next/dev/**`: transient dev output (incl. the `.next/dev/server` build).
    // The whole subtree is excluded, so no trailing-segment guard is needed.
    if (segments[index] === ".next" && segments[index + 1] === "dev") return true;
    // `<root>/server/<file>`: server build output directly under the root. The
    // trailing-segment guard avoids matching a file literally named `server`.
    if (segments[index + 1] === "server" && index + 2 < segments.length) return true;
  }
  return false;
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
