export const getTailwindArbitraryUtilityValue = (utility: string, prefix: string): string | null =>
  utility.startsWith(prefix) && utility.endsWith("]") ? utility.slice(prefix.length, -1) : null;
