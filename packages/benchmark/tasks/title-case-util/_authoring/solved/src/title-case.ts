// Capitalizes the first letter of each whitespace-separated word and lowercases
// the rest.
export const titleCase = (input: string): string => {
  const words = input
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
};
