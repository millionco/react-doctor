// Splits an array into fixed-size chunks. The final chunk holds the remainder.
export const chunkArray = <ItemType>(
  items: ReadonlyArray<ItemType>,
  chunkSize: number,
): ItemType[][] => {
  const safeSize = Math.max(1, Math.floor(chunkSize));
  const chunks: ItemType[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
};
