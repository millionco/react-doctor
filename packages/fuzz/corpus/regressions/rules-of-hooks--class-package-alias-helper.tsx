// rule: rules-of-hooks
// weakness: import-provenance
// source: DTStack/molecule 69e4f3bc8b6f2028571d92e76ee49ba3eb88ba94
import { useContextView } from "mo/components/contextView";

export class Select {
  contextView: unknown;

  constructor() {
    this.contextView = useContextView({ shadowOutline: false });
  }
}
