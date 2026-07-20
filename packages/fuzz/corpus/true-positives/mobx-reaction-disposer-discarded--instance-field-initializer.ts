// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1405 review (instance fields run once per construction)
import { autorun } from "mobx";
import { externalStore } from "./external-store";

export class Store {
  readonly initialized = (autorun(() => externalStore.value), true);
}
