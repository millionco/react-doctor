import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface SearchHandle {
  reset(): void;
}

interface SearchProperties {
  initialQuery: string;
}

const Search = forwardRef<SearchHandle, SearchProperties>(({ initialQuery }, ref) => {
  const [query, setQuery] = useState(initialQuery);
  useImperativeHandle(
    ref,
    () => ({
      reset: () => setQuery(""),
    }),
    [],
  );
  return <output>{query}</output>;
});

export const Application = () => {
  const searchRef = useRef<SearchHandle | null>(null);
  useEffect(() => {
    searchRef.current?.reset();
  }, []);
  return <Search ref={searchRef} initialQuery="react" />;
};
