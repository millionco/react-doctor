import { paginate } from "./paginate.ts";

interface ResultsViewProps {
  rows: string[];
  page: number;
}

// Existing consumer (keeps paginate.ts reachable). Do not edit.
export const ResultsView = ({ rows, page }: ResultsViewProps) => {
  const result = paginate(rows, page, 10);
  return (
    <p>
      Page {result.page} of {result.totalPages}
    </p>
  );
};
