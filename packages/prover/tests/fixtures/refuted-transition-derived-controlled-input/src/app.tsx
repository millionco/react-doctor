import { startTransition, useState } from "react";

export const Search = () => {
  const [query, setQuery] = useState("");
  const displayedQuery = query.trim();

  return (
    <section>
      <button type="button" onClick={() => startTransition(() => setQuery("react"))}>
        Search
      </button>
      <input aria-label="Search" value={displayedQuery} readOnly />
    </section>
  );
};
