import * as fs from "node:fs";

export const hasValidFileMarker = (markerPath: string, expectedContent: string): boolean => {
  if (!fs.existsSync(markerPath)) return false;
  const markerStats = fs.lstatSync(markerPath);
  return (
    markerStats.isFile() &&
    !markerStats.isSymbolicLink() &&
    fs.readFileSync(markerPath, "utf8") === expectedContent
  );
};
