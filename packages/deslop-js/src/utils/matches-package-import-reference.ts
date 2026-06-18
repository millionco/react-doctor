import { escapeRegExp } from "./escape-reg-exp.js";

export const matchesPackageImportReference = (content: string, packageName: string): boolean => {
  const escapedPackageName = escapeRegExp(packageName);
  const subpathPattern = `(?:/[^'"]*)?`;
  const patterns = [
    new RegExp(`\\bfrom\\s+['"]${escapedPackageName}${subpathPattern}['"]`),
    new RegExp(
      `\\bimport\\s+(?:[^'";\\n]*?\\sfrom\\s+)?['"]${escapedPackageName}${subpathPattern}['"]`,
    ),
    new RegExp(`\\brequire\\s*\\(\\s*['"]${escapedPackageName}${subpathPattern}['"]\\s*\\)`),
    new RegExp(`\\brequire\\s*\\(\\s*\`${escapedPackageName}${subpathPattern}`),
    new RegExp(`\\bimport\\s*\\(\\s*['"]${escapedPackageName}${subpathPattern}['"]`),
  ];

  return patterns.some((pattern) => pattern.test(content));
};
