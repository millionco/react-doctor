import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoRestDestructuring } from "./query-no-rest-destructuring.js";

describe("tanstack-query/query-no-rest-destructuring — regressions", () => {
  it("stays silent on a non-TanStack `useQuery` (Convex)", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "convex/react"; const { page, ...rest } = useQuery(api.messages.list);`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a TanStack `useQuery` rest-destructure", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query"; const { data, ...rest } = useQuery({ queryKey: ["x"] });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a rest-destructure of an aliased TanStack import", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery as useTodosQuery } from "@tanstack/react-query"; const { data, ...rest } = useTodosQuery({ queryKey: ["todos"] });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a namespace call: ReactQuery.useQuery(...)", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import * as ReactQuery from "@tanstack/react-query"; const { data, ...rest } = ReactQuery.useQuery({ queryKey: ["todos"] });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a namespace call from a non-TanStack module", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import * as Convex from "convex/react"; const { page, ...rest } = Convex.useQuery(api.messages.list);`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a two-step rest-destructure of a const query-result binding", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query"; const queryResult = useQuery({ queryKey: ["todos"] }); const { data, ...rest } = queryResult;`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags rest destructuring through multiple exact const aliases", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query";
const queryResult = useQuery({ queryKey: ["todos"] });
const exactResult = queryResult;
const finalResult = exactResult;
const { data, ...rest } = finalResult;`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a namespace query result through multiple exact const aliases", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import * as ReactQuery from "@tanstack/react-query";
const queryResult = ReactQuery.useQuery({ queryKey: ["todos"] });
const exactResult = queryResult;
const { data, ...rest } = exactResult;`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a two-step rest-destructure of a reassignable binding", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query"; let queryResult = useQuery({ queryKey: ["todos"] }); queryResult = fallback; const { data, ...rest } = queryResult;`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when an alias chain reaches a reassignable binding", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query";
let queryResult = useQuery({ queryKey: ["todos"] });
queryResult = fallback;
const exactResult = queryResult;
const { data, ...rest } = exactResult;`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on conditional query-result aliases", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query";
const queryResult = useQuery({ queryKey: ["todos"] });
const selectedResult = condition ? queryResult : fallback;
const { data, ...rest } = selectedResult;`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a same-named local shadows an aliased query result", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query";
const queryResult = useQuery({ queryKey: ["todos"] });
const exactResult = queryResult;
function read(exactResult) {
  const { data, ...rest } = exactResult;
  return rest;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a local hook shadows a TanStack import", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import { useQuery } from "@tanstack/react-query";
function read(useQuery) {
  const { data, ...rest } = useQuery();
  return rest;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags exact namespace and hook aliases", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `import * as ReactQuery from "@tanstack/react-query";
const QueryNamespace = ReactQuery;
const useItemsQuery = QueryNamespace["useQuery"];
const { data, ...rest } = useItemsQuery({ queryKey: ["items"] });`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an unimported global useQuery", () => {
    const { diagnostics } = runRule(
      queryNoRestDestructuring,
      `const { data, ...rest } = useQuery({ queryKey: ["items"] });`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
