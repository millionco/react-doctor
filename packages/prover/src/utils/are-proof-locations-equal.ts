import type { ReactProofLocation } from "../types.js";

export const areProofLocationsEqual = (
  left: ReactProofLocation,
  right: ReactProofLocation,
): boolean =>
  left.filePath === right.filePath && left.line === right.line && left.column === right.column;
