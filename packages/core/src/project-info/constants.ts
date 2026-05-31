export const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?)$/;

// Bundler output — IIFE / UMD / global builds and explicitly-minified
// drops (e.g. tsup/rollup emitting `widget.iife.js`, `sdk.umd.js`,
// `app.global.js`, or `vendor.min.js`, often landing in `public/`
// alongside real source rather than an ignored `dist/`) — is generated,
// usually minified, and not worth linting. Flagging a 17k-line bundle is
// pure noise, so these are excluded from every source-file scan by
// default. Only `.js` is matched: these are browser-shippable bundles,
// and `.cjs`/`.mjs` aren't source files anyway.
export const GENERATED_BUNDLE_FILE_PATTERN = /\.(iife|umd|global|min)\.js$/i;

// Minified / generated files (e.g. a one-line `public/inject.js` bundle)
// don't carry the `.min`/`.iife` extension we can match on, so we sniff
// content. A file is treated as minified only when BOTH hold: it has a
// line longer than this AND its average line is long (see below). The
// two-signal test avoids false-flagging a real source file that merely
// contains one long line (an inline SVG `<path d="…">`, a base64 data
// URI, a generated single-line GraphQL document) among many short ones.
export const MINIFIED_MAX_LINE_LENGTH_CHARS = 1000;
// Companion to the max-line check: genuine minified output packs almost
// everything onto a few enormous lines, so its average line length runs
// into the thousands, whereas hand-written source with one stray long line
// averages well under this. Both thresholds must trip to flag a file as
// minified. The floor is deliberately well above the average of dense-but-
// real source (i18n catalogs, generated route/data tables, files of long
// string-literal rows top out in the low hundreds) so those aren't silently
// dropped from the scan, while true minified bundles still clear it easily.
export const MINIFIED_AVG_LINE_LENGTH_CHARS = 500;
// Only read this many bytes when sniffing for minification — a minified
// file's huge lines show up immediately, so we never read the whole bundle.
export const MINIFIED_SNIFF_BYTES = 65_536;
// Skip the content sniff entirely for files smaller than this; minified
// bundles are large, & this keeps full-tree discovery from reading every
// small source file. Smaller minified files are still caught downstream
// (diagnostic parsing + the code-frame guard).
export const MINIFIED_MIN_SIZE_BYTES = 20_000;

export const GIT_LS_FILES_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);
