// Paths excluded from slop grading. Tests, stories, fixtures, generated output,
// and dependency/build directories are neither rewarded nor penalized: an agent
// should not earn credit for writing tests, nor be charged for slop in code it
// did not author (vendored / generated). The agent's *product* code is graded.
const NON_GRADABLE_PATTERNS: readonly RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out|coverage|\.next|\.turbo)\//,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /(^|\/)__mocks__\//,
  /(^|\/)__fixtures__\//,
  /(^|\/)fixtures?\//,
  /\.(test|spec|stories)\.[mc]?[jt]sx?$/,
  /\.d\.[mc]?ts$/,
  /(^|\/)[^/]*\.(lock|lockb)$/,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/,
];

// Only these extensions carry React/TS slop the scanners understand.
const GRADABLE_EXTENSION_PATTERN = /\.[mc]?[jt]sx?$/;

export const isGradableFile = (filePath: string): boolean => {
  if (!GRADABLE_EXTENSION_PATTERN.test(filePath)) return false;
  return !NON_GRADABLE_PATTERNS.some((pattern) => pattern.test(filePath));
};
