import { escapeRegExp } from "./escape-reg-exp.js";

const PACKAGE_VALUE_OPTION_PATTERN =
  "(?:--browser\\.provider|--format|--formatter|--loader|--plugin|--preset|--reporter|--require|--test-results-processor|--testResultsProcessor|-r)";

export const matchesPackageCliOptionReference = (command: string, packageName: string): boolean => {
  const escapedPackageName = escapeRegExp(packageName);
  return new RegExp(
    `(?:^|\\s)${PACKAGE_VALUE_OPTION_PATTERN}(?:=|\\s+)${escapedPackageName}(?:/[^\\s'"\`]*)?(?=$|\\s|[;|&])`,
  ).test(command);
};
