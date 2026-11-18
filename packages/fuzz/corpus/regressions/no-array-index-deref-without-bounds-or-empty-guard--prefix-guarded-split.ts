// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: primitive-prefix-guard
// source: synthetic audit regression
export const readQuery = (input: unknown) => {
  const value = input;
  if (typeof value === "string" && value.startsWith("?")) {
    return value.split("?")[1].trim();
  }
  return "";
};
