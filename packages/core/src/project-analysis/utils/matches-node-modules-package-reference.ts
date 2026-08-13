import { escapeRegExp } from "./escape-reg-exp.js";

export const matchesNodeModulesPackageReference = (
  command: string,
  packageName: string,
): boolean => {
  const packagePathPattern = packageName.split("/").map(escapeRegExp).join("[\\\\/]");
  const binaryNamePattern = escapeRegExp(packageName);
  const pattern = new RegExp(
    "(?:^|[^A-Za-z0-9_.-])node_modules[\\\\/](?:" +
      packagePathPattern +
      "(?=$|[\\\\/])|\\.bin[\\\\/]" +
      binaryNamePattern +
      "(?=$|[^A-Za-z0-9_.-]))",
  );
  return pattern.test(command);
};
