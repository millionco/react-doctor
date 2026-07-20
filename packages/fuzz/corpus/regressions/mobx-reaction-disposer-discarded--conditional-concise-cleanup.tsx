// rule: mobx-reaction-disposer-discarded
// weakness: dataflow
// source: PR #1405 review (conditional concise effect forwards disposer ownership)
import { reaction } from "mobx";
import { useEffect } from "react";
import { refresh, store } from "./store";

export const useStoreReaction = (enabled: boolean) => {
  useEffect(() => (enabled ? reaction(() => store.value, refresh) : undefined), [enabled]);
};
