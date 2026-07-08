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

  it("stays silent on a POST to a read-named RPC endpoint (jumper get-zap-data shape)", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      "const r = useQuery({ queryKey: ['zapData'], queryFn: () => fetch(`${apiBaseUrl}/zaps/get-zap-data`, { method: 'POST', body: JSON.stringify({ chain }) }).then((r) => r.json()) });",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a polled query with refetchInterval (jumper routes-quote shape)", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const POST_ENDPOINT = 'https://li.quest/v1/advanced/routes';
      const r = useQuery({
        queryKey: ['SeiWalletLinking'],
        queryFn: () => fetch(POST_ENDPOINT, { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.json()),
        refetchInterval: 1000 * 60 * 60,
      });`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a POST to a write-named endpoint even with refetchInterval: false", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({
        queryKey: ['x'],
        queryFn: () => fetch('/api/users/create', { method: 'POST', body }),
        refetchInterval: false,
      });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a DELETE to a read-named endpoint (only POST gets the RPC-read pass)", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['x'], queryFn: () => fetch('/api/get-user', { method: 'DELETE' }) });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a POST whose URL merely contains a read word inside a longer segment", () => {
    const { diagnostics } = runRule(
      queryNoUseQueryForMutation,
      `const r = useQuery({ queryKey: ['x'], queryFn: () => fetch('/api/gettysburg/update', { method: 'POST', body }) });`,
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
