import * as semver from "semver";
import type { ProjectInfo } from "../types/index.js";

// React Compiler's `immutability` rule fires on the canonical Reanimated
// pattern `sharedValue.value = ...` because the Compiler treats hook
// return values as immutable. The generic "move the modification into the
// hook" suggestion can't be satisfied for a library-owned value, so point
// users at Reanimated's Compiler-compliant `.get()` / `.set()` accessors
// instead. Gated to projects that actually depend on react-native-reanimated
// so the hint never appears where it can't apply.
// Docs: https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support
const REANIMATED_SHARED_VALUE_HINT =
  "If this is a Reanimated shared value, prefer its React Compiler-compatible `.get()` / `.set()` accessors over `.value` — https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support";

// `.get()` / `.set()` landed in reanimated 3.15.0
// (software-mansion/react-native-reanimated#6312) — recommending them to a
// project pinned below that would point users at methods that don't exist.
const ACCESSORS_MIN_VERSION = "3.15.0";

// Lower bound of a range (`^3.16.1` → 3.16.1), with `coerce` as the
// fallback for non-range specs that still embed a version. Tags
// (`latest`, `next`) resolve to null and are treated optimistically as
// new enough — mirrors the Tailwind-version fallback policy.
const supportsAccessors = (reanimatedVersion: string | null): boolean => {
  if (reanimatedVersion === null) return true;
  const lowerBound =
    semver.validRange(reanimatedVersion) !== null
      ? semver.minVersion(reanimatedVersion)
      : semver.coerce(reanimatedVersion);
  if (lowerBound === null) return true;
  return semver.gte(lowerBound, ACCESSORS_MIN_VERSION);
};

export const appendReanimatedSharedValueHint = (
  help: string,
  rule: string,
  project: ProjectInfo,
): string => {
  if (rule !== "immutability") return help;
  if (!project.hasReanimated) return help;
  if (!supportsAccessors(project.reanimatedVersion)) return help;
  if (!help) return REANIMATED_SHARED_VALUE_HINT;
  return `${help}\n\n${REANIMATED_SHARED_VALUE_HINT}`;
};
