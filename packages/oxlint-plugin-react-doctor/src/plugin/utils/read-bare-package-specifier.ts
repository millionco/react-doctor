interface BarePackageSpecifier {
  readonly packageName: string;
  readonly subpath: string;
}

const BARE_PACKAGE_SPECIFIER_PATTERN =
  /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)((?:\/[a-z0-9][a-z0-9._-]*)*)$/;

export const readBarePackageSpecifier = (source: string): BarePackageSpecifier | null => {
  const match = BARE_PACKAGE_SPECIFIER_PATTERN.exec(source);
  if (!match) return null;
  const [, packageName, subpath] = match;
  return packageName ? { packageName, subpath: subpath ? `.${subpath}` : "." } : null;
};
