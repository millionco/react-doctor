// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1000 deep adversarial audit
import { autorun } from "mobx";

export class StoreRegistry {
  static {
    autorun(syncRegistry);
  }
}
