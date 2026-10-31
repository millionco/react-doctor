// rule: no-fetch-in-effect
// weakness: wrapper-transparency
// source: independent synthetic exact effect callback alias regression
// verdict: fail
import { useCallback, useEffect } from "react";
export const SearchPanel = ({ query }) => {
  const load = useCallback(async (value) => {
    await fetch(value);
  }, []);
  const effect = () => {
    load(query);
  };
  useEffect(effect, [query, load]);
  return null;
};
