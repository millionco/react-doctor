import * as mobx from "mobx";

export class CastMobxNamespace {
  value = 0;

  start() {
    (mobx as typeof mobx).autorun(() => this.value);
  }
}
