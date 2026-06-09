// Removes duplicates by a derived key, keeping the first item per key and
// preserving order.
export const uniqueBy = <Item, Key>(
  items: readonly Item[],
  selector: (item: Item) => Key,
): Item[] => {
  const seen = new Set<Key>();
  const result: Item[] = [];
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};
