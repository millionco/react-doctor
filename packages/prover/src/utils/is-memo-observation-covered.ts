export const isMemoObservationCovered = (
  observationPath: string,
  equalPropPaths: ReadonlyArray<string>,
): boolean =>
  equalPropPaths.some(
    (equalPropPath) =>
      equalPropPath.length === 0 ||
      equalPropPath === observationPath ||
      (observationPath !== "*" && observationPath.startsWith(`${equalPropPath}.`)),
  );
