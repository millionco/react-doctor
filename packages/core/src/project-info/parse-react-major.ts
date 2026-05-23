// HACK: react-doctor reads the project's React version straight out of
// package.json, which produces semver ranges (`^19.0.0`, `~18.3.1`,
// `>=18 <20`, `19.x`, `latest`, etc.) — never a normalized number. The
// rule registry needs an integer major to gate React-19-only rules
// (e.g. `no-react19-deprecated-apis`, `no-default-props`) without
// false-positive flagging on React 17 / 18 codebases.
//
// We drop upper-bound comparators, then grab the first semver-like lower-bound
// integer.
// That gives the right answer for every lower-bound shape we see in
// practice:
//   "19.0.0" → 19, "^18.3.1" → 18, "~17.0.2" → 17, ">=18 <20" → 18,
//   "19.x" → 19, "<19" → null, "workspace:*" → null, "*" → null.
//
// Returning `null` for tags ("latest", "next"), workspace protocols,
// and ranges that don't carry a concrete lower bound is intentional:
// callers should treat `null` as "unknown — do not enable version-gated
// rules" so React-19-only migrations don't false-positive on React 18
// projects whose exact version could not be classified.
import { getLowestDependencyMajor } from "./utils/dependency-version-spec.js";

export const parseReactMajor = (reactVersion: string | null | undefined): number | null => {
  if (typeof reactVersion !== "string") return null;
  return getLowestDependencyMajor(reactVersion);
};
