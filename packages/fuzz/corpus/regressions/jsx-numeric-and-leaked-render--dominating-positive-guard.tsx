// rule: jsx-numeric-and-leaked-render
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (cloudscape tree item: the dominating operand proves the length positive, so a 0 can never render)
export const TreeItem = ({
  item,
  expandedItems,
  getItemChildren,
  id,
}: {
  item: { id: string };
  expandedItems: string[];
  getItemChildren: (item: { id: string }) => { id: string }[] | undefined;
  id: string;
}) => {
  const children = getItemChildren(item) || [];
  const isExpandable = children.length > 0;
  const isExpanded = isExpandable && expandedItems.includes(id);
  return (
    <li>
      {isExpanded && children.length && (
        <ul>
          {children.map((child) => (
            <TreeItem
              key={child.id}
              item={child}
              expandedItems={expandedItems}
              getItemChildren={getItemChildren}
              id={child.id}
            />
          ))}
        </ul>
      )}
    </li>
  );
};
