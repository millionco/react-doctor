import type { PackageJson } from "../../../types/index.js";
import { getLowestDependencyMajor } from "../../../project-info/utils/dependency-version-spec.js";

// The Expo SDK major a project targets, derived from the `expo` package
// version spec — `expo@^51.x` ⇒ SDK 51, since the `expo` package's major
// tracks the SDK release one-to-one. Returns `null` for unresolvable
// specs (dist-tags, `workspace:*`, pure upper bounds) so SDK-gated checks
// can stay quiet rather than false-positive when the target SDK is
// unknown. Mirrors `parseReactMajor`'s optimistic-on-null contract.
export const getExpoSdkMajor = (packageJson: PackageJson): number | null => {
  const expoSpec = packageJson.dependencies?.expo ?? packageJson.devDependencies?.expo;
  if (typeof expoSpec !== "string") return null;
  return getLowestDependencyMajor(expoSpec);
};
