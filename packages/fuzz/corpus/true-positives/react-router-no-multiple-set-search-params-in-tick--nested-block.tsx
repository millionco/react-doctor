// rule: react-router-no-multiple-set-search-params-in-tick
// weakness: cross-block-call-order
// source: Bugbot PR #1411

import { useSearchParams } from "react-router";

export const Filters = ({ compact }) => {
  const [, setSearchParams] = useSearchParams();
  setSearchParams({ page: "1" });
  if (compact) {
    setSearchParams({ view: "compact" });
  }
  return null;
};
