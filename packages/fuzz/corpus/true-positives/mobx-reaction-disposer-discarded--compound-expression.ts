// rule: mobx-reaction-disposer-discarded
// weakness: discarded compound expression
// source: Cursor Bugbot review of millionco/react-doctor#1365

import { autorun, reaction } from "mobx";

export class Store {
  start(enabled: boolean) {
    enabled && autorun(() => this.sync());
    const marker = (reaction(() => this.value, this.persist), 0);
    return marker;
  }
}
