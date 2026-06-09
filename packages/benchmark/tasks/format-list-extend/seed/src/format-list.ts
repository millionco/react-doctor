// Joins a list of names into a human sentence, e.g. ["a","b","c"] -> "a, b and c".
export function formatList(items: any, conjunction?: any): any {
  const c = conjunction ? conjunction : "and";
  return items.length === 0
    ? ""
    : items.length === 1
      ? items[0]
      : items.length === 2
        ? items[0] + " " + c + " " + items[1]
        : items.slice(0, -1).join(", ") + " " + c + " " + items[items.length - 1];
}
