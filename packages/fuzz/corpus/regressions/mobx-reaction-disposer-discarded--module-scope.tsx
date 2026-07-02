// rule: mobx-reaction-disposer-discarded
// weakness: control-flow
// source: PR #1000 adversarial review (app-lifetime wiring has no teardown moment)
import { reaction } from "mobx";
import { store, persist } from "./store";

reaction(
  () => store.value,
  (value) => persist(value),
);

export const READY = true;
