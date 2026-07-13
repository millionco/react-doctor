import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCascadingSetState } from "./no-cascading-set-state.js";

describe("state-and-effects/no-cascading-set-state", () => {
  it("is retired because synchronous setters in one effect share a React commit", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const BatchedUpdates = ({ revision }: { revision: number }) => {
        const [page, setPage] = useState(0);
        const [error, setError] = useState<Error | null>(new Error());
        const [loading, setLoading] = useState(false);
        useEffect(() => {
          setPage(revision);
          setError(null);
          setLoading(true);
        }, [revision]);
        return <output>{page}:{String(error)}:{String(loading)}</output>;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps the retired rule quiet when explicitly configured on legacy source", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const LegacyRootComponent = () => {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        const [third, setThird] = useState(0);
        useEffect(() => {
          setFirst(1);
          setSecond(2);
          setThird(3);
        });
        return <output>{first + second + third}</output>;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
