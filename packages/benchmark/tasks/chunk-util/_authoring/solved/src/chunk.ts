// Splits an array into consecutive chunks of length `size`. Implemented inline
// (no utility-library dependency) to keep the bundle lean.
export const chunkize = <Item>(items: readonly Item[], size: number): Item[][] => {
  if (size < 1) return [];
  const chunks: Item[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};
