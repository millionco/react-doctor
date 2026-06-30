import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoUseQueryForMutation } from "./query-no-use-query-for-mutation.js";

describe("tanstack-query/query-no-usequery-for-mutation — regressions", () => {
  it("stays silent on a GraphQL read (POST to a /graphql endpoint)", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['users'], queryFn: () => fetch('/graphql', { method: 'POST', body: JSON.stringify({ query }) }).then((r) => r.json()) });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a genuine mutating fetch inside useQuery", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['users'], queryFn: () => fetch('/api/users', { method: 'DELETE' }) });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
