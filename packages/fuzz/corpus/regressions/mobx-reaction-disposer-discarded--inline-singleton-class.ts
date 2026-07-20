// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1405 review (inline module singleton has process lifetime)
import { autorun } from "mobx";

export const store = new (class {
  private value = 0;

  constructor() {
    autorun(() => this.persist(this.value));
  }

  private persist(value: number) {
    localStorage.setItem("value", String(value));
  }
})();
