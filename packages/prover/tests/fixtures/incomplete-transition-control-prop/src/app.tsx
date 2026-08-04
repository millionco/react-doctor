import { startTransition, useState } from "react";

interface SearchFieldProperties {
  value: string;
}

const SearchField = ({ value }: SearchFieldProperties) => <input value={value} readOnly />;

export const Search = () => {
  const [query, setQuery] = useState("");

  return (
    <section>
      <button type="button" onClick={() => startTransition(() => setQuery("react"))}>
        Search
      </button>
      <SearchField value={query} />
    </section>
  );
};
