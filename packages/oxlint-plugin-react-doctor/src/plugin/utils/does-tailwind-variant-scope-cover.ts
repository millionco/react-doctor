export const doesTailwindVariantScopeCover = (
  candidateScope: ReadonlyArray<string>,
  targetScope: ReadonlyArray<string>,
): boolean => {
  let targetVariantIndex = 0;

  for (const candidateVariant of candidateScope) {
    while (
      targetVariantIndex < targetScope.length &&
      targetScope[targetVariantIndex] !== candidateVariant
    ) {
      targetVariantIndex += 1;
    }
    if (targetVariantIndex === targetScope.length) return false;
    targetVariantIndex += 1;
  }

  return true;
};
