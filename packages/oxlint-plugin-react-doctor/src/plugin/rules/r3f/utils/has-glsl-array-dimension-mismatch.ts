export const hasGlslArrayDimensionMismatch = (
  firstArraySize: number | null | undefined,
  secondArraySize: number | null | undefined,
): boolean =>
  (firstArraySize === null) !== (secondArraySize === null) ||
  (typeof firstArraySize === "number" &&
    typeof secondArraySize === "number" &&
    firstArraySize !== secondArraySize);
