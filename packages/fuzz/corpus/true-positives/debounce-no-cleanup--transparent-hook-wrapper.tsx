import debounce from "lodash/debounce";
import { useEffect, useMemo } from "react";

export const Search = () => {
  const search = (useMemo(() => debounce(() => (document.title = "late"), 100), []) as any)!;
  useEffect(() => search(), [search]);
  return null;
};
