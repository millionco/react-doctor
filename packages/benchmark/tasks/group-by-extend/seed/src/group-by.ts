// Groups a list of records by the value of a property. Currently only supports
// a property name as the key selector.
export function groupBy(items: any, key: any): any {
  const result: any = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const k = item[key];
    if (result[k] === undefined) {
      result[k] = [];
    }
    result[k].push(item);
  }
  return result;
}
