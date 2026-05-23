import type { PackageJson } from "../types/index.js";
import { parseReactMajor } from "./parse-react-major.js";
import { hasUpperBoundOnlyPeerRange, peerRangeMinMajor } from "./parse-react-peer-range.js";

export const resolveEffectiveReactMajor = (
  reactVersion: string | null,
  packageJson: PackageJson,
): number | null => {
  const installedReactMajor = parseReactMajor(reactVersion);
  const peerReactRange = packageJson.peerDependencies?.react;
  if (typeof peerReactRange !== "string") return installedReactMajor;

  const peerFloor = peerRangeMinMajor(peerReactRange);
  if (peerFloor === null) {
    return hasUpperBoundOnlyPeerRange(peerReactRange) ? null : installedReactMajor;
  }
  return installedReactMajor !== null ? Math.min(installedReactMajor, peerFloor) : peerFloor;
};
