import type { PackageJson } from "../types/project-info.js";
import { parseReactMajor } from "./parse-react-major.js";
import { peerRangeMinMajor } from "./parse-react-peer-range.js";

export const resolveEffectiveReactMajor = (
  reactVersion: string | null,
  packageJson: PackageJson,
): number | null => {
  const installedReactMajor = parseReactMajor(reactVersion);
  const peerFloor = peerRangeMinMajor(packageJson.peerDependencies?.react);
  return peerFloor !== null && installedReactMajor !== null
    ? Math.min(installedReactMajor, peerFloor)
    : (peerFloor ?? installedReactMajor);
};
