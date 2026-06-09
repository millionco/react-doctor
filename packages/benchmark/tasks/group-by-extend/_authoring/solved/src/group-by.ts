export type GroupKey = string | number;

// Groups a list by a property name or a selector function. The result maps each
// distinct key (stringified) to the items that produced it, in first-seen order.
export const groupBy = <Item>(
  items: readonly Item[],
  key: keyof Item | ((item: Item) => GroupKey),
): Record<string, Item[]> => {
  const deriveKey = typeof key === "function" ? key : (item: Item) => String(item[key]);
  const result: Record<string, Item[]> = {};
  for (const item of items) {
    const groupKey = String(deriveKey(item));
    (result[groupKey] ??= []).push(item);
  }
  return result;
};
