// rule: jsx-numeric-and-leaked-render
// weakness: control-flow
export const List = ({ items }: { items: unknown[] }) => {
  let hasItems = items.length > 0;
  hasItems = true;
  return <>{hasItems && items.length && <span />}</>;
};
