import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryDestructureResult } from "./query-destructure-result.js";

describe("tanstack-query/query-destructure-result", () => {
  it("flags assigning a whole TanStack Query result to a variable", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";
       const query = useQuery({ queryKey: ["a"], queryFn: load });`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the legacy react-query package source", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "react-query";
       const query = useQuery({ queryKey: ["a"], queryFn: load });`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves aliased TanStack Query imports", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery as useTsQuery } from "@tanstack/react-query";
       const query = useTsQuery({ queryKey: ["a"], queryFn: load });`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Convex useQuery, which returns data directly", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "convex/react";
       const contact = useQuery(api.contacts.getContact, { contactId });`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a same-named useQuery from Apollo", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@apollo/client";
       const query = useQuery(GET_CONTACT);`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useQuery with no resolvable import", () => {
    const result = runRule(
      queryDestructureResult,
      `const contact = useQuery(api.contacts.getContact, { contactId });`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag destructured TanStack Query usage", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";
       const { data, isLoading } = useQuery({ queryKey: ["a"], queryFn: load });`,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
