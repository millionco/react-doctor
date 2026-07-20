// rule: mobx-reaction-disposer-discarded
import { autorun } from "mobx";

const Store = class StoreImplementation {
  constructor() {
    autorun(() => this.synchronize());
  }

  synchronize() {}
};

export const store = new Store();
