// rule: rules-of-hooks
// verdict: pass
// file-path: corpus/regressions/rules-of-hooks--imported-data-getter.tsx
import { useRecord } from "./rules-of-hooks--static-data-helper";
export class Repository {
  read() {
    return useRecord();
  }
}
