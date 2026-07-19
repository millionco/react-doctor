// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: copy-tracking
export const Sorted = ({ items, copy }: { items: string[]; copy: boolean }) => {
  if (copy) items = items.slice();
  return items.sort();
};
