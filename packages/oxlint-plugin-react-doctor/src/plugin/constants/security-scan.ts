// Path/context patterns shared by MULTIPLE security-scan scan rules
// (see `src/plugin/utils/file-scan.ts` for what a file scan is).
// Patterns used by exactly one rule stay module-local in that rule's file.
// Secret-value patterns shared with the AST secret rules live next to
// SECRET_PATTERNS in `./security.ts`.

export const TEXT_FILE_PATTERN =
  /\.(?:[cm]?[jt]sx?|json|jsonc|map|html?|mdx?|ya?ml|toml|sql|rules|env|txt|log|svg|xml|pem|key|crt|cert|pub|py|php)$/i;

export const DOTENV_FILE_PATTERN = /(?:^|\/)\.env(?:\.|$)/;

export const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;

export const SCRIPT_SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|py|php)$/i;

export const DATABASE_SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|py)$/i;

export const SERVER_CONTEXT_PATTERN =
  /(?:^|\/)(?:api|backend|server|servers|middleware|route|routes|functions|lambdas|workers)(?:\/|$)|(?:^|\/)[^/]+\.server\.[cm]?[jt]sx?$/i;

export const TEST_CONTEXT_PATTERN =
  /(?:^|\/)(?:__fixtures__|__mocks__|__tests__|fixtures|mocks|test|tests|testdata|test-data|e2e|playwright)(?:\/|$)|\.(?:test|spec|e2e|e2e-spec|integration-test|fixture|fixtures|stories|story)\.[cm]?[jt]sx?$|(?:^|\/)(?:test_[^/]+|[^/]+_test|conftest)\.py$|\.env\.[^/]*(?:test|e2e)[^/]*$/i;

// `tools/` is deliberately not excluded: agent/MCP tool definitions live there.
export const BUILD_SCRIPT_CONTEXT_PATTERN = /(?:^|\/)scripts(?:\/|$)/i;

export const DEMO_CONTEXT_PATTERN =
  /(?:^|\/)(?:examples?|tutorials?|demos?|samples?|playgrounds?)(?:\/|$)/i;

export const DOCUMENTATION_CONTEXT_PATTERN =
  /(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|PUBLISHING|DOCS)\.mdx?$|\.mdx?$/i;

// Vendored directories and version-pinned filenames (`jsonwebtoken@8.5.1.js`)
// are third-party code the project does not own; their internals (cipher
// tables, exec helpers) are not this repository's security posture.
export const GENERATED_SOURCE_CONTEXT_PATTERN =
  /(?:^|\/)(?:generated|__generated__|dist|build|coverage|out|storybook-static|vendor|vendors|third[-_]?party|libraries)(?:\/|$)|(?:^|\/)\.next\/|(?:^|\/)\.yarn\/|(?:^|\/)public\/(?:chunks?|assets?|build|dist|static)\/|(?:generated|\.gen)\.[cm]?[jt]sx?$|@\d+\.\d+\.\d+(?:[-.][\w.]+)?\.[cm]?js$|[.-]min\.[cm]?js$|\.asm\.js$|(?:^|\/)[\w-]+[.@-]\d+\.\d+\.\d+(?:[-.][\w.]+)?\//i;

// Filename-only bundle test (the walker content-sniffs minified files
// separately). Distinct from @react-doctor/core's same-named pattern,
// which also matches `.mjs`.
export const GENERATED_BUNDLE_FILE_PATTERN = /\.(iife|umd|global|min)\.js$/i;

export const BROWSER_ARTIFACT_PATH_PATTERNS = [
  /(?:^|\/)\.next\/static\//,
  /(?:^|\/)\.output\/public\//,
  /(?:^|\/)build\/static\//,
  /(?:^|\/)dist\/assets\//,
  /(?:^|\/)public\//,
  /(?:^|\/)out\//,
  /(?:^|\/)storybook-static\//,
];

export const AGENT_TOOL_DANGEROUS_CAPABILITY_PATTERN =
  /\b(?:exec|execSync|spawn|child_process|eval|new Function|vm\.run|readFile|writeFile|fs\.read|fs\.write|fetch|axios|http\.request|sandbox|runCode|executeCode)\b/;
