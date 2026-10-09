// rule: rules-of-hooks
// verdict: pass
import { createSignal } from "solid-js";
import { useRecord } from "./record";

export const useChoice = (enabled) => {
  const [choice] = createSignal(null);
  if (enabled) return useRecord(choice());
  return null;
};
