// rule: jsx-numeric-and-leaked-render
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const globalThis = { note: 0 };
interface globalThis {}
globalThis.note = 1;
const useRows = (rows) => {
  const total = Array.isArray(rows) ? rows.length : undefined;
  return { total };
};
export const RowSummary = ({ rows }) => {
  const { total } = useRows(rows);
  return <section>{total && <output>Rows</output>}</section>;
};
