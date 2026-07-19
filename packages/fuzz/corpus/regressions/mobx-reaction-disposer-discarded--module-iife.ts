// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1365 deep audit
import { autorun } from "mobx";
import { store } from "./store";

(() => {
  autorun(() => console.log(store.value));
})();
