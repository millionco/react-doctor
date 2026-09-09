import { filterSourceFiles } from "@react-doctor/core";
import { toForwardSlashes } from "./path-format.js";

export interface HasUnlintedSurvivingBaseFileInput {
  readonly baseLintPaths: ReadonlyArray<string>;
  readonly headFiles: ReadonlySet<string>;
  readonly analyzedBaseFiles: ReadonlyArray<string>;
}

// A base file deleted at head has no counterpart to compare against, so only an
// unanalyzed base file that survives at head can hide a pre-existing finding.
export const hasUnlintedSurvivingBaseFile = (input: HasUnlintedSurvivingBaseFileInput): boolean => {
  const analyzedBaseFiles = new Set(input.analyzedBaseFiles.map(toForwardSlashes));
  return filterSourceFiles(input.baseLintPaths.map(toForwardSlashes)).some(
    (filePath) => input.headFiles.has(filePath) && !analyzedBaseFiles.has(filePath),
  );
};
