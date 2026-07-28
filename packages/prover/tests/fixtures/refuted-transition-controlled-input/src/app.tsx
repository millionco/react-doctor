import { startTransition, useState } from "react";
import type { ChangeEvent } from "react";

export const Search = () => {
  const [query, setQuery] = useState("");

  const updateQuery = (event: ChangeEvent<HTMLInputElement>) => {
    startTransition(() => {
      setQuery(event.currentTarget.value);
    });
  };

  return <input aria-label="Search" value={query} onChange={updateQuery} />;
};
