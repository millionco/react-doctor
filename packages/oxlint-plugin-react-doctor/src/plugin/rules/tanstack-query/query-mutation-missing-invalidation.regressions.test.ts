import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryMutationMissingInvalidation } from "./query-mutation-missing-invalidation.js";

describe("tanstack-query/query-mutation-missing-invalidation — regressions", () => {
  it("stays silent when a destructured `invalidateQueries` is called in onSuccess", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const { invalidateQueries } = useQueryClient(); useMutation({ mutationFn: deletePost, onSuccess: () => invalidateQueries({ queryKey: ["posts"] }) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a mutation with no cache update at all", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `useMutation({ mutationFn: deletePost });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when tRPC utils invalidate the cache in onSuccess", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const utils = api.useUtils(); useMutation({ mutationFn: toggleMonitor, onSuccess: () => utils.monitors.invalidate() });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a bare clear() destructured from an unrelated form helper", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const { clear } = useForm(); useMutation({ mutationFn: deletePost, onSuccess: () => clear() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a bare invalidate() defined as an unrelated local helper", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `const invalidate = () => setDirty(false); useMutation({ mutationFn: deletePost, onSuccess: () => invalidate() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags session.invalidate() on a non-query object", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `useMutation({ mutationFn: signOut, onSuccess: () => session.invalidate() });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a mutation whose onSuccess only shows a toast", () => {
    const { diagnostics } = runRule(
      queryMutationMissingInvalidation,
      `useMutation({ mutationFn: deletePost, onSuccess: () => toast.success("deleted") });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
