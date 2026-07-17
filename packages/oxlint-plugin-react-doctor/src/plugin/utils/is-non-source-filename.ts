// Bundled / minified / vendored output is not actionable source — renames
// and derefs there are build-time artifacts, not author decisions.
// `/public/` is the static-assets convention (CRA/Next) — scripts there
// are served verbatim (vendored jQuery plugins, analytics snippets), never
// app source.
const NON_SOURCE_FILENAME_MARKERS = [
  "/dist/",
  "/build/",
  ".min.",
  ".umd.",
  "/.yalc/",
  "/vendor/",
  "/public/",
];

export const isNonSourceFilename = (filename: string | undefined): boolean => {
  if (!filename) return false;
  const normalizedFilename = `/${filename.replaceAll("\\", "/")}`;
  return NON_SOURCE_FILENAME_MARKERS.some((marker) => normalizedFilename.includes(marker));
};
