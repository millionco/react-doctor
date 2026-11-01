// pass: jsx-numeric-and-leaked-render
const useEntries = (items) => {
  const count = Array.isArray(items) ? items.length : undefined;
  return { count };
};
export const Example = ({ items }) => {
  const { count } = useEntries(items);
  const hasEntries = count > 0;
  return <section>{hasEntries && count && <output>Ready</output>}</section>;
};
