import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiTqUseRawQueryAtom } from "./jotai-tq-use-raw-query-atom.js";

describe("jotai/jotai-tq-use-raw-query-atom — regressions", () => {
  it("stays silent on a cross-file *QueryAtom that is a plain search-string atom", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { searchQueryAtom } from './atoms'; import { useAtomValue } from 'jotai'; function SearchBox() { const value = useAtomValue(searchQueryAtom); return value; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a file-local atom created by atomWithQuery", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { atomWithQuery } from 'jotai-tanstack-query'; import { useAtomValue } from 'jotai'; const userAtom = atomWithQuery(() => ({ queryKey: ['u'] })); function C() { return useAtomValue(userAtom); }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
