export interface ParsedPackageVersion {
  major: number;
  minor: number;
  patch: number;
  isPrerelease: boolean;
}

export const parsePackageVersion = (version: string): ParsedPackageVersion | null => {
  const match = version.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    isPrerelease: Boolean(match[4]),
  };
};
