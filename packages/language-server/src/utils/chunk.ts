/** Splits `items` into consecutive chunks of at most `size` (size >= 1). */
export const chunk = <Item>(items: ReadonlyArray<Item>, size: number): Item[][] => {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
};
