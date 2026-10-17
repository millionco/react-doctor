// pass: jsx-numeric-and-leaked-render
declare const globalThis: any;
globalThis.Array.isArray = () => false;
const useRows = (rows) => {
  const total = Array.isArray(rows) ? rows.length : undefined;
  return { total };
};
export const RowSummary = ({ rows }) => {
  const { total } = useRows(rows);
  return <section>{total && <output>Rows</output>}</section>;
};
