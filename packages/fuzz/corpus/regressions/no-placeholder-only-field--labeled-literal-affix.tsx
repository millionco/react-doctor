// rule: no-placeholder-only-field
// weakness: dynamic-computed
// source: synthetic associated-label control
// verdict: pass

interface ResultSearchProps {
  readonly total: number;
}

export const ResultSearch = ({ total }: ResultSearchProps) => (
  <label htmlFor="record-search">
    Search records
    <input id="record-search" placeholder={`${total} matching records`} />
  </label>
);
