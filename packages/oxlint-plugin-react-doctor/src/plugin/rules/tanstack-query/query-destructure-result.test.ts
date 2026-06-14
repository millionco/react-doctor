import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryDestructureResult } from "./query-destructure-result.js";

describe("tanstack-query/query-destructure-result", () => {
  it("flags a whole-result assignment from TanStack Query useQuery", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "@tanstack/react-query";\nconst query = useQuery(options);`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags useQuery from the legacy react-query package", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "react-query";\nconst query = useQuery(options);`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Convex useQuery imported from convex/react", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery } from "convex/react";\nconst contact = useQuery(api.contacts.getContact, { contactId });`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an aliased Convex useQuery", () => {
    const result = runRule(
      queryDestructureResult,
      `import { useQuery as useConvexQuery } from "convex/react";\nconst contact = useConvexQuery(api.contacts.getContact);`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags useQuery with no import in the file (preserves prior behavior)", () => {
    const result = runRule(queryDestructureResult, `const query = useQuery(options);`);

    expect(result.diagnostics).toHaveLength(1);
  });
});
