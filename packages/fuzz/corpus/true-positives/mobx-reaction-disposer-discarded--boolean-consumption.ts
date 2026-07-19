// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1365 deep audit

import { autorun } from "mobx";

export const mountFeature = () => {
  if (autorun(() => state.value)) consume();
};
