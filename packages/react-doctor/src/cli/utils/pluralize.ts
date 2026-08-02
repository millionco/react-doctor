export const pluralize = (count: number, singularNoun: string): string =>
  `${count} ${singularNoun}${count === 1 ? "" : "s"}`;
