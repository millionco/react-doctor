// rule: mobx-reaction-disposer-discarded
// weakness: cleanup-call-proof
// source: PR #1000 deep adversarial audit
import { autorun } from "mobx";

export const mountStore = () => {
  autorun(syncStore, { signal: undefined });
};
