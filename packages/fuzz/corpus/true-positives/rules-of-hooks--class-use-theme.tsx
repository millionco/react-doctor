// rule: rules-of-hooks
// weakness: import-provenance
// source: blinkospace/blinko 8bd89a6b4d7f07a2ee3ab2e01cb6dfb855017f91
// verdict: fail

import { useTheme } from "next-themes";

export class ThemeStore {
  use() {
    return useTheme();
  }
}
