// HACK: extracts the lowest concrete React major from a peer-dependency
// range. Used to compute the effective React version for libraries:
// a library with `"react": "^17 || ^18 || ^19"` has an effective major
// of 17, so version-gated rules that require React 19+ are suppressed.
const COMPARATOR_SEPARATOR = /[\s,|]+/;
const WILDCARD_COMPARATOR = /^[*xX](?:\.[*xX])*$/;

const extractComparatorMajor = (comparator: string): number | null => {
  if (WILDCARD_COMPARATOR.test(comparator)) return null;
  const firstIntegerMatch = comparator.match(/\d+/);
  if (!firstIntegerMatch) return null;
  const major = Number.parseInt(firstIntegerMatch[0], 10);
  return major >= 1 ? major : null;
};

export const peerRangeMinMajor = (range: string | null | undefined): number | null => {
  if (typeof range !== "string") return null;
  let lowestMajor: number | null = null;
  for (const comparator of range.trim().split(COMPARATOR_SEPARATOR).filter(Boolean)) {
    const major = extractComparatorMajor(comparator);
    if (major !== null && (lowestMajor === null || major < lowestMajor)) {
      lowestMajor = major;
    }
  }
  return lowestMajor;
};
