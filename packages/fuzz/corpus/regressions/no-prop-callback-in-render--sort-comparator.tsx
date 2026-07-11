// rule: no-prop-callback-in-render
// weakness: library-idiom
// source: PR #1130 Bugbot review
interface SortableListProps {
  compareItems: (firstItem: string, secondItem: string) => number;
  items: string[];
}

export const SortableList = ({ compareItems, items }: SortableListProps) => {
  const sortedItems = [...items];
  sortedItems.sort((firstItem, secondItem) => compareItems(firstItem, secondItem));
  return <div>{sortedItems.join(", ")}</div>;
};
