// fail: jsx-numeric-and-leaked-render
const useEntries = (items) => {
  const count = Array.isArray(items) ? items.length : undefined;
  return { count };
};
export const Example = ({ items }) => {
  const { count } = useEntries(items);
  return <section>{count && <output>Ready</output>}</section>;
};
