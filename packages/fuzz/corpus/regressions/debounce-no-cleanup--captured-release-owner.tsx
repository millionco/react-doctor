// rule: debounce-no-cleanup
// verdict: pass
// weakness: alias-guard
// source: authored captured-release owner regression

import { useEffect, useMemo } from "react";
import { debounce } from "es-toolkit/compat";

export const DirectSearch = ({ query }) => {
  const search = useMemo(
    () =>
      debounce(async () => {
        await fetch("/synthetic-search");
      }, 500),
    [],
  );
  const stop = search.cancel;
  globalThis.finishDirect = () => stop();
  useEffect(() => {
    search(query);
  }, [query, search]);
  return null;
};

export const DelegatedSearch = ({ query }) => {
  const search = useMemo(
    () =>
      debounce(async () => {
        await fetch("/synthetic-search");
      }, 500),
    [],
  );
  const stop = search.cancel;
  const inner = () => stop();
  const finish = () => inner();
  globalThis.finishDelegated = finish;
  useEffect(() => {
    search(query);
  }, [query, search]);
  return null;
};
