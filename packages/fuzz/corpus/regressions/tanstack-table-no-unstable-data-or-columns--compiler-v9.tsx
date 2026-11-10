// rule: tanstack-table-no-unstable-data-or-columns
// source: GitHub issue #2206 and TanStack Table v9 compiler guide
import { useTable } from "@tanstack/react-table";

export const Grid = ({ rows }) => {
  const columns = [{ accessorKey: "name" }];
  const table = useTable({ data: rows.filter((row) => row.active), columns });
  return <div>{String(table)}</div>;
};
