// rule: no-pass-data-to-parent
// weakness: alias-guard
// source: invented selected-member provenance regression
// verdict: pass
import { useEffect, useReducer } from "react";
import { importedCallback } from "./external-callback";

export const Child = ({ parentProp }) => {
  const [localValue] = useReducer((previousValue) => previousValue + 1, 0);
  const handlers = { notify: parentProp, dispatch: importedCallback };
  const chosen = handlers.dispatch;
  useEffect(() => {
    chosen(localValue);
  }, [chosen, localValue]);
  return null;
};
