import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryDestructureResult } from "./query-destructure-result.js";

describe("tanstack-query/query-destructure-result", () => {
  it("flags spreading the whole TanStack useQuery result into JSX", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";\nfunction C() {\n  const query = useQuery(options);\n  return <Inner {...query} />;\n}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags spreading the whole result into an object literal", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";\nfunction C() {\n  const query = useQuery(options);\n  const view = { ...query, label: "todos" };\n  return view.data;\n}`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves rest-destructuring through a later binding to query-no-rest-destructuring", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";\nfunction C() {\n  const query = useQuery(options);\n  const { data, ...rest } = query;\n  return [data, rest];\n}`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a spread of a useInfiniteQuery result from the legacy react-query package", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useInfiniteQuery } from "react-query";\nfunction C() {\n  const query = useInfiniteQuery(options);\n  return <Inner {...query} />;\n}`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a whole-result assignment consumed via property access", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";\nfunction C() {\n  const query = useQuery(options);\n  if (query.isLoading) return null;\n  return query.data;\n}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a spread of Convex useQuery imported from convex/react", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "convex/react";\nfunction C() {\n  const contact = useQuery(api.contacts.getContact, { contactId });\n  return <Inner {...contact} />;\n}`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an aliased Convex useQuery", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery as useConvexQuery } from "convex/react";\nfunction C() {\n  const contact = useConvexQuery(api.contacts.getContact);\n  return <Inner {...contact} />;\n}`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a spread of useQuery with no import in the file", () => {
    const result = runRule(
      queryDestructureResult,
      `function C() {\n  const query = useQuery(options);\n  return <Inner {...query} />;\n}`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
