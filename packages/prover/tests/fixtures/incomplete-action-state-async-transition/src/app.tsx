import { startTransition, useActionState } from "react";

export const SearchIndex = () => {
  const [query, dispatchQuery] = useActionState(
    (_previousQuery: string, nextQuery: string) => nextQuery,
    "",
  );
  const handleSearch = () => {
    startTransition(async () => {
      await Promise.resolve();
      dispatchQuery("react");
    });
  };
  return (
    <button type="button" onClick={handleSearch}>
      Search for {query}
    </button>
  );
};
