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

// Every rule asks about the same filename while a file lints, so a one-entry
// memo absorbs the substring scans for all but the first call per file.
let lastFilename: string | undefined;
let lastResult = false;

export const isNonSourceFilename = (filename: string | undefined): boolean => {
  if (!filename) return false;
  if (filename === lastFilename) return lastResult;
  const normalizedFilename = `/${filename.replaceAll("\\", "/")}`;
  lastFilename = filename;
  lastResult = NON_SOURCE_FILENAME_MARKERS.some((marker) => normalizedFilename.includes(marker));
  return lastResult;
};
