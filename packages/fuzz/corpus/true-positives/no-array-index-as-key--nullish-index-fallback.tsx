// rule: no-array-index-as-key
// weakness: reachable-expression-branch
// source: React Bench write-react-lobehub-lobe-ui-508__EAtLqrE

interface RowData {
  id?: string;
  label: string;
}

export const StatefulRows = ({ rows }: { rows: RowData[] }) =>
  rows.map((row, index) => <div key={row.id ?? index}>{row.label}</div>);
