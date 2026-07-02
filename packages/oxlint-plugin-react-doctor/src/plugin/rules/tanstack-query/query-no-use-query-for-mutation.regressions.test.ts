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

  it("stays silent on a template-literal GraphQL URL with a dynamic base", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      "const r = useQuery({ queryKey: ['x'], queryFn: () => fetch(`${BASE}/graphql`, { method: 'POST', body }) });",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a const-resolved GraphQL URL", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const GRAPHQL_URL = "/graphql"; const r = useQuery({ queryKey: ['x'], queryFn: () => fetch(GRAPHQL_URL, { method: "POST" }) });`,
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

  it("still flags a DELETE to a /graphql URL (spec only sanctions POST)", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['x'], queryFn: () => fetch('/graphql', { method: 'DELETE' }) });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a DELETE to a REST URL that merely contains 'graphql'", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['x'], queryFn: () => fetch('/api/graphql-schemas/123', { method: 'DELETE' }) });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a statically visible GraphQL mutation POSTed inside useQuery", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({
        queryKey: ['deleteUser'],
        queryFn: () => fetch('/graphql', {
          method: 'POST',
          body: JSON.stringify({ query: 'mutation DeleteUser($id: ID!) { deleteUser(id: $id) { id } }' }),
        }).then((res) => res.json()),
      });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
