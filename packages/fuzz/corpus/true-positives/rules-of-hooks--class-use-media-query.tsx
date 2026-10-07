// rule: rules-of-hooks
// weakness: import-provenance
// source: blinkospace/blinko 8bd89a6b4d7f07a2ee3ab2e01cb6dfb855017f91
// verdict: fail

import { useMediaQuery } from "usehooks-ts";

export class ResponsiveStore {
  useLayout() {
    return useMediaQuery("(min-width: 768px)");
  }
}
