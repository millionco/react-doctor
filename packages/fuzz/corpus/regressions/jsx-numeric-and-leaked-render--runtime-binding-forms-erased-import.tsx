// rule: jsx-numeric-and-leaked-render
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
import type globalThis = require("provider-types");
globalThis.Array.isArray = () => false;
const useRows = (rows) => {
  const total = Array.isArray(rows) ? rows.length : undefined;
  return { total };
};
export const RowSummary = ({ rows }) => {
  const { total } = useRows(rows);
  return <section>{total && <output>Rows</output>}</section>;
};
