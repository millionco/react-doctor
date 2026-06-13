import type { DiagnosticFileContext } from "./types/index.js";

// HACK: most rules in react-doctor's curated set encode "you wouldn't
// want this in production code" — but tests intentionally exercise
// bad patterns to lock in regression coverage (an array-index key in a
// test fixture, a giant fixture component, a `forwardRef` to verify
// ref forwarding). Surface-level path matching is enough to catch the
// near-universal test conventions: `.test.*` / `.spec.*` suffix, or
// living under a `__tests__` / `tests` / `test` directory.
//
// We use combined regexes against the forward-slash relative path so
// the match is allocation-free per diagnostic. The story and test
// suffix patterns share one extension grammar so they can never drift
// apart — `isTestFilePath` is derived from this classifier, making
// "the label and the suppression always agree" structural.
const SCRIPT_EXTENSION_FRAGMENT = "[cm]?[jt]sx?";
const STORY_FILE_SUFFIX_PATTERN = new RegExp(
  `\\.(?:stories|story)\\.(?:${SCRIPT_EXTENSION_FRAGMENT})$`,
);
const TEST_FILE_SUFFIX_PATTERN = new RegExp(
  `\\.(?:test|spec|fixture|fixtures)\\.(?:${SCRIPT_EXTENSION_FRAGMENT})$`,
);
const TEST_FILE_DIRECTORY_PATTERN =
  /(?:^|\/)(?:__tests__|__test__|tests|test|__mocks__|cypress|e2e|playwright)\//;

// "Source root" markers — once a path contains `/src/`, `/app/`,
// `/lib/`, `/pages/`, etc., everything BELOW that is production code
// regardless of how the project is laid out above. Critical for test
// fixture projects (`tests/fixtures/<proj>/src/...`) so the FIXTURE
// source files don't get auto-suppressed just because the outer wrap
// happens to have `/tests/` or `/fixtures/` in the path.
//
// We only strip when a `/fixtures/` (or `/__fixtures__/`) segment is
// present, because that's the unambiguous signal of "fixture project —
// the inner source root is the real production code under lint".
// For regular layouts like `tests/app/setup.ts` or `e2e/components/
// helpers.ts`, the `app` / `components` segment is just a sub-folder
// of the test directory, NOT a real source root, so stripping would
// incorrectly drop the `tests/` / `e2e/` prefix and the file would
// no longer be detected as a test.
const FIXTURE_PROJECT_PATTERN = /\/(?:fixtures|__fixtures__)\//;
const SOURCE_ROOT_PATTERN =
  /\/(?:src|app|lib|components|pages|features|modules|packages|apps|frontend|client)\//g;

const stripAboveSourceRoot = (relativePath: string): string => {
  const fixtureMatch = FIXTURE_PROJECT_PATTERN.exec(relativePath);
  if (fixtureMatch === null) return relativePath;
  let lastIdx = -1;
  for (const match of relativePath.matchAll(SOURCE_ROOT_PATTERN)) {
    if (match.index !== undefined && match.index > lastIdx) lastIdx = match.index;
  }
  if (lastIdx >= 0) return relativePath.slice(lastIdx);
  // No inner source-root marker — strip up through the fixture segment
  // so the outer `tests/` / `e2e/` prefix can't re-trigger the test
  // heuristic on fixture production files like
  // `tests/fixtures/my-app/Component.tsx`. The fixture itself is the
  // unit under test; its contents are production-shaped code.
  return relativePath.slice(fixtureMatch.index + fixtureMatch[0].length - 1);
};

/**
 * Classifies where a file sits relative to shipped code. A finding in a
 * `.stories.tsx` or `.spec.ts` file never runs in front of users, so
 * renderers label those sites instead of framing them as production
 * impact (`rn-no-raw-text` in a spec doesn't say users crash).
 *
 * `"story"` is the `.stories.*` / `.story.*` suffix; `"test"` is the
 * test/spec/fixture suffixes and test directories; `"production"` is
 * the default.
 */
export const classifyFileContext = (relativePath: string): DiagnosticFileContext => {
  if (relativePath.length === 0) return "production";
  const forwardSlashed = relativePath.replaceAll("\\", "/");
  // The SUFFIX checks (.stories/.test/.spec etc.) are on the FULL path —
  // unambiguous regardless of context.
  if (STORY_FILE_SUFFIX_PATTERN.test(forwardSlashed)) return "story";
  if (TEST_FILE_SUFFIX_PATTERN.test(forwardSlashed)) return "test";
  // The DIRECTORY check (`tests/`, `__tests__/`, `cypress/`, etc.)
  // scopes to the source-root-below path so that fixture-project
  // source files don't get falsely auto-suppressed.
  const scoped = stripAboveSourceRoot(forwardSlashed);
  return TEST_FILE_DIRECTORY_PATTERN.test(scoped) ? "test" : "production";
};
