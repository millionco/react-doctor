export const areStaticPropertyPathsDisjoint = (
  firstPath: ReadonlyArray<string>,
  secondPath: ReadonlyArray<string>,
): boolean =>
  firstPath.some((segment, index) => index < secondPath.length && segment !== secondPath[index]);
