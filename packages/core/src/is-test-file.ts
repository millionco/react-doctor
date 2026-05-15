// HACK: most rules in react-doctor's curated set encode "you wouldn't
// want this in production code" — but tests intentionally exercise
// bad patterns to lock in regression coverage (an array-index key in a
// test fixture, a giant fixture component, a `forwardRef` to verify
// ref forwarding). Surface-level path matching is enough to catch the
// near-universal test conventions: `.test.*` / `.spec.*` suffix, or
// living under a `__tests__` / `tests` / `test` directory.
//
// We use a single combined regex against the forward-slash relative
// path so the match is allocation-free per diagnostic.
const TEST_FILE_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|__test__|tests|test|__mocks__|cypress|e2e|playwright)\/|\.(?:test|spec|stories|story|fixture|fixtures)\.(?:[cm]?[jt]sx?)$/;

export const isTestFilePath = (relativePath: string): boolean => {
  if (relativePath.length === 0) return false;
  const forwardSlashed = relativePath.replaceAll("\\", "/");
  return TEST_FILE_PATH_PATTERN.test(forwardSlashed);
};
