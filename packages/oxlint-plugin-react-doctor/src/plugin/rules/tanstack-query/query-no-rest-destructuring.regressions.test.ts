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
});
