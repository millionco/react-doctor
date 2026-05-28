import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiTqUseRawQueryAtom } from "./jotai-tq-use-raw-query-atom.js";

describe("jotai-tq-use-raw-query-atom", () => {
  it("flags useAtomValue subscribing to an atomWithQuery binding", () => {
    const code = `
      import { atomWithQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithQuery(() => ({ queryKey: ["user"], queryFn }));
      function UserProfile() {
        const result = useAtomValue(userQueryAtom);
        return result.data?.name;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Derive the field");
  });

  it("flags useAtom subscribing to an atomWithQuery binding", () => {
    const code = `
      import { atomWithQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithQuery(() => ({ queryKey: ["user"], queryFn }));
      function UserProfile() {
        const [result] = useAtom(userQueryAtom);
        return result.data?.name;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atomWithSuspenseQuery binding consumer", () => {
    const code = `
      import { atomWithSuspenseQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithSuspenseQuery(() => ({ queryKey: ["user"], queryFn }));
      function UserProfile() {
        const result = useAtomValue(userQueryAtom);
        return result.data?.name;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atomWithInfiniteQuery binding consumer", () => {
    const code = `
      import { atomWithInfiniteQuery } from "jotai-tanstack-query";
      const feedQueryAtom = atomWithInfiniteQuery(() => ({ queryKey: ["feed"], queryFn }));
      function Feed() {
        return useAtomValue(feedQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a derived atom consumer (atom(g => g(queryAtom).data))", () => {
    const code = `
      import { atom } from "jotai";
      import { atomWithQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithQuery(() => ({ queryKey: ["user"], queryFn }));
      const userDataAtom = atom((get) => get(userQueryAtom).data);
      function UserProfile() {
        const data = useAtomValue(userDataAtom);
        return data?.name;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag useSetAtom on the query binding (mutation pattern)", () => {
    // `useSetAtom` doesn't subscribe to the value, so there's no
    // re-render cost from envelope churn.
    const code = `
      import { atomWithQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithQuery(() => ({ queryKey: ["user"], queryFn }));
      function Refresh() {
        const set = useSetAtom(userQueryAtom);
        return null;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag atomWithMutation consumer (no observer envelope)", () => {
    const code = `
      import { atomWithMutation } from "jotai-tanstack-query";
      const saveAtom = atomWithMutation(() => ({ mutationFn }));
      function Save() {
        const [{ mutate }] = useAtom(saveAtom);
        return null;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag query bindings imported from a non-jotai-tq source", () => {
    const code = `
      import { atomWithQuery } from "./my-atoms";
      const userQueryAtom = atomWithQuery({ queryKey: ["user"] });
      function UserProfile() {
        return useAtomValue(userQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag aliased atomWithQuery imports (file-local binding still tracked)", () => {
    const code = `
      import { atomWithQuery as makeQueryAtom } from "jotai-tanstack-query";
      const userQueryAtom = makeQueryAtom(() => ({ queryKey: ["user"], queryFn }));
      function UserProfile() {
        return useAtomValue(userQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag useAtomValue on an unrelated plain atom", () => {
    const code = `
      import { atom } from "jotai";
      const counterAtom = atom(0);
      function Counter() {
        return useAtomValue(counterAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags cross-file imported `*QueryAtom` binding (naming convention)", () => {
    const code = `
      import { userQueryAtom } from "./atoms";
      function UserProfile() {
        const result = useAtomValue(userQueryAtom);
        return result.data?.name;
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags cross-file imported `*SuspenseQueryAtom` binding", () => {
    const code = `
      import { userSuspenseQueryAtom } from "./atoms";
      function UserProfile() {
        return useAtomValue(userSuspenseQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags cross-file imported `*InfiniteQueryAtom` binding", () => {
    const code = `
      import { feedInfiniteQueryAtom } from "./atoms";
      function Feed() {
        return useAtomValue(feedInfiniteQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag cross-file binding without the QueryAtom suffix", () => {
    const code = `
      import { userAtom } from "./atoms";
      function UserProfile() {
        return useAtomValue(userAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag bindings imported from `jotai` itself", () => {
    const code = `
      import { someQueryAtom } from "jotai";
      function UserProfile() {
        return useAtomValue(someQueryAtom);
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag useAtomValue called with a non-identifier expression", () => {
    const code = `
      import { atomWithQuery } from "jotai-tanstack-query";
      const userQueryAtom = atomWithQuery(() => ({ queryKey: ["user"] }));
      function UserProfile() {
        return useAtomValue(makeAtom());
      }
    `;
    const result = runRule(jotaiTqUseRawQueryAtom, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
