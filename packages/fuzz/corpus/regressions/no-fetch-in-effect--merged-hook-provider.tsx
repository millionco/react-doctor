// rule: no-fetch-in-effect
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: pass
const rewriteProvider = () => {
  interface useCallback {}
  mutate(useCallback);
};
rewriteProvider();

import { useCallback, useEffect, useState } from "react";
const SearchPanel = ({ query }) => {
  const [rows, setRows] = useState([]);
  const load = useCallback(async (value) => {
    const response = await fetch("/api/items?key=" + value);
    const data = await response.json();
    setRows(data);
  }, []);
  useEffect(() => {
    load(query);
  }, [query, load]);
  return null;
};
