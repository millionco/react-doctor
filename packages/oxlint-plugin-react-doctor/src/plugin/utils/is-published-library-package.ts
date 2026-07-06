import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";

// True when the nearest `package.json` describes a publishable library that
// declares `react` as a peer dependency — the shape of a shipped component
// library. Bundle-splitting decisions for such packages belong to the
// consuming application, not inside the library, so "ships to your users up
// front" advice is misdirected there. Apps (which mark `"private": true` and
// depend on react directly) are never classified as libraries.
export const isPublishedLibraryPackage = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return false;
  return (
    manifest.private !== true &&
    typeof manifest.peerDependencies === "object" &&
    manifest.peerDependencies !== null &&
    "react" in manifest.peerDependencies
  );
};
