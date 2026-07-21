export const SOURCE_FILE_PATTERN = /\.(tsx?|jsx?|mts|mjs)$/;

// Bundler output — IIFE / UMD / global builds and explicitly-minified
// drops (e.g. tsup/rollup emitting `widget.iife.js`, `sdk.umd.js`,
// `app.global.js`, or `vendor.min.js`, often landing in `public/`
// alongside real source rather than an ignored `dist/`) — is generated,
// usually minified, and not worth linting. Flagging a 17k-line bundle is
// pure noise, so these are excluded from every source-file scan by
// default. Only `.js` / `.mjs` are matched: these are browser-shippable
// bundles, and `.cjs` isn't part of the scanner's source-file set.
export const GENERATED_BUNDLE_FILE_PATTERN = /\.(iife|umd|global|min)\.m?js$/i;

// Codegen output directories (`src/__generated__/form.stories.tsx`): the
// generator, not the file, owns any fix, so diagnostics there are never
// actionable and linters conventionally exclude them.
export const GENERATED_SOURCE_DIRECTORY_PATTERN = /(?:^|\/)__generated__\//;

export const TAILWIND_POSTCSS7_COMPAT_ALIAS = "npm:@tailwindcss/postcss7-compat";
export const TAILWIND_POSTCSS7_COMPAT_MAJOR = 2;
export const TAILWIND_POSTCSS7_COMPAT_MINOR = 0;

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

// Hidden (dot-)directories are excluded from source discovery by default:
// they hold tool state and agent/editor tooling (`.codex`, `.claude`,
// `.cursor`, `.agents`, `.vscode`, `.github`, …) whose scripts are not app
// code — scanning them surfaces noise like `no-console` on Node CLI
// helpers. These are the deliberate exceptions: dot-directories that hold
// real React source (docs frameworks, Storybook config components).
export const SCANNED_DOT_DIRECTORIES = new Set([".dumi", ".storybook"]);

export const IGNORED_DIRECTORIES = new Set([
  ".angular",
  ".astro",
  ".cache",
  ".contentlayer",
  ".direnv",
  ".docusaurus",
  ".expo",
  ".firebase",
  ".git",
  ".gradle",
  ".hg",
  ".next",
  ".nuxt",
  ".nx",
  ".output",
  ".parcel-cache",
  ".serverless",
  ".svelte-kit",
  ".svn",
  ".terraform",
  ".turbo",
  ".venv",
  ".vercel",
  ".wrangler",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);
