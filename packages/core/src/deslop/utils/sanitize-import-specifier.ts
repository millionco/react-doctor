export const sanitizeImportSpecifier = (specifier: string): string => {
  if (specifier.startsWith("node:") || specifier.startsWith("data:") || specifier.includes("://")) {
    return specifier;
  }

  const lastLoaderSeparator = specifier.lastIndexOf("!");
  let cleaned = lastLoaderSeparator === -1 ? specifier : specifier.slice(lastLoaderSeparator + 1);

  const queryIndex = cleaned.indexOf("?");
  if (queryIndex !== -1) cleaned = cleaned.slice(0, queryIndex);

  const fragmentIndex = cleaned.indexOf("#", 1);
  if (fragmentIndex !== -1) cleaned = cleaned.slice(0, fragmentIndex);

  return cleaned || specifier;
};
