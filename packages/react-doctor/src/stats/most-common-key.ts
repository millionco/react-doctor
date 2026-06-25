/**
 * The map key with the highest count, or undefined when the map is empty. Used
 * to pick a session's dominant model from per-message model tallies.
 */
export const mostCommonKey = (counts: ReadonlyMap<string, number>): string | undefined => {
  let bestKey: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
};
