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

  it("stays silent on a cross-file searchQueryAtom used as a plain string", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { searchQueryAtom } from '@/store/atoms';
       import { useAtomValue } from 'jotai';
       function SearchBox() { return useAtomValue(searchQueryAtom); }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a cross-file query atom whose result is destructured as an envelope", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { userQueryAtom } from './atoms';
       import { useAtomValue } from 'jotai';
       function UserProfile() { const { data, isLoading } = useAtomValue(userQueryAtom); return isLoading ? null : data.name; }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags a cross-file query atom whose useAtom tuple value is read as an envelope", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { feedQueryAtom } from './atoms';
       import { useAtom } from 'jotai';
       function Feed() { const [result] = useAtom(feedQueryAtom); return result.isLoading ? null : result.data; }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("flags a component defined above the atomWithQuery declaration in the same file", () => {
    const { diagnostics } = runRule(
      jotaiTqUseRawQueryAtom,
      `import { atomWithQuery } from 'jotai-tanstack-query';
       import { useAtomValue } from 'jotai';
       function C() { return useAtomValue(userAtom); }
       const userAtom = atomWithQuery(() => ({ queryKey: ['u'] }));`,
    );
    expect(diagnostics).toHaveLength(1);
  });
});
