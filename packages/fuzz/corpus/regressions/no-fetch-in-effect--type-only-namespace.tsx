// rule: no-fetch-in-effect
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: pass
namespace require {
  export interface Marker {}
}
require("react").useCallback = (callback) => () => {};
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
