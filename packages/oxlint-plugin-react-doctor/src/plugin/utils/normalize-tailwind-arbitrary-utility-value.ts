export const normalizeTailwindArbitraryUtilityValue = (value: string): string =>
  value.replace(/(?<!\\)_/g, " ");
