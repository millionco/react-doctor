import { escapeRegExp } from "./escape-reg-exp.js";

// True when `packageName` appears as a standalone CLI token anywhere in a
// command string — not only as the leading binary. Catches deps passed as a
// flag argument, e.g. `jest --testResultsProcessor jest-sonar-reporter` or
// `--reporter=jest-junit`, which the binary-only matcher misses. The token may
// carry a `/subpath` (`some-pkg/register`) but must be bounded by a command
// separator (whitespace, `=`, quote, paren, or shell operator) on both sides so
// `my-jest-sonar-reporter` / `jest-sonar-reporter-extra` don't match.
export const matchesPackageTokenReference = (command: string, packageName: string): boolean => {
  const escapedPackageName = escapeRegExp(packageName);
  const pattern = new RegExp(
    `(?:^|[\\s='"\`(,;:|&])${escapedPackageName}(?:/[^\\s'"\`]*)?(?=$|[\\s='"\`),;:|&])`,
  );
  return pattern.test(command);
};
