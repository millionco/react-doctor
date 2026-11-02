// rule: no-placeholder-only-field
// weakness: dynamic-computed
// source: synthetic literal-affix regression
// verdict: fail

interface ResultSearchProps {
  readonly total: number;
}

export const ResultSearch = ({ total }: ResultSearchProps) => (
  <input placeholder={total + " matching records"} />
);
