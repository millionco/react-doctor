// rule: no-placeholder-only-field
// weakness: dynamic-computed
// source: final adversarial review
// verdict: pass

interface SearchFieldProps {
  readonly field: Record<string, unknown>;
}

export const SearchField = ({ field }: SearchFieldProps) => (
  <input placeholder="Search docs" {...field} />
);
