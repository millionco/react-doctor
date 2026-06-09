import { parseQuery } from "./parse-query.ts";

interface FilterSummaryProps {
  search: string;
}

// Existing consumer (keeps parse-query.ts reachable). Do not edit.
export const FilterSummary = ({ search }: FilterSummaryProps) => {
  const params = parseQuery(search);
  return <span>{Object.keys(params).length} filters</span>;
};
