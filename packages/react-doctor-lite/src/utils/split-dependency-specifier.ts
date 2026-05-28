export interface DependencySpecifier {
  name: string;
  range: string | null;
}

// Splits a combined specifier like `"react@>=19"` or
// `"@tanstack/react-query@^5"` into its name and range. The range delimiter
// is the LAST `@` that is not the leading scope marker, so scoped packages
// without a range (`"@tanstack/react-query"`) parse correctly.
export const splitDependencySpecifier = (specifier: string): DependencySpecifier => {
  const scopeOffset = specifier.startsWith("@") ? 1 : 0;
  const delimiterIndex = specifier.indexOf("@", scopeOffset);
  if (delimiterIndex === -1) {
    return { name: specifier, range: null };
  }
  return {
    name: specifier.slice(0, delimiterIndex),
    range: specifier.slice(delimiterIndex + 1),
  };
};
