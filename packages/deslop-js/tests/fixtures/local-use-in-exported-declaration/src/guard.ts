export const isLikelyBookTitleAuthorResult = (value: string): boolean => value.includes(" by ");

export const splitAuthorSearchResults = (values: string[]): string[] =>
  values.filter((value) => isLikelyBookTitleAuthorResult(value));

export const neverReferencedAnywhere = (value: string): string => value.trim();
