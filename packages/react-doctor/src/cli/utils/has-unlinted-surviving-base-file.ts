import { filterSourceFiles } from "@react-doctor/core";
import { toForwardSlashes } from "./path-format.js";

/**
 * Whether the base lint pass left a file unanalyzed that still exists at head.
 * Those are the only gaps that can hide a pre-existing finding: a base file
 * deleted at head has no head counterpart, so skipping it can only undercount
 * fixed findings, never surface a stale one as new.
 */
export const hasUnlintedSurvivingBaseFile = (input: {
  readonly baseLintPaths: ReadonlyArray<string>;
  readonly headFiles: ReadonlySet<string>;
  readonly analyzedBaseFiles: ReadonlyArray<string>;
}): boolean => {
  const analyzedBaseFiles = new Set(input.analyzedBaseFiles.map(toForwardSlashes));
  return filterSourceFiles(input.baseLintPaths.map(toForwardSlashes)).some(
    (filePath) => input.headFiles.has(filePath) && !analyzedBaseFiles.has(filePath),
  );
};
