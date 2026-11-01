export interface DependencyRangeSemantics {
  readonly normalize: (version: string) => string | null;
  readonly minimumMajor: (version: string) => number | null;
  readonly permitsMajorAbove: (version: string, supportedMajor: number) => boolean;
}

export const getContainedDependencyMajor = (
  version: string,
  latestSupportedMajor: number,
  semantics: DependencyRangeSemantics,
): number | null => {
  const normalizedVersion = semantics.normalize(version);
  if (normalizedVersion === null) return null;
  const minimumMajor = semantics.minimumMajor(normalizedVersion);
  if (minimumMajor === null || minimumMajor > latestSupportedMajor) return null;
  return semantics.permitsMajorAbove(normalizedVersion, latestSupportedMajor) ? null : minimumMajor;
};
