import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutableInDeps } from "./no-mutable-in-deps.js";

describe("no-mutable-in-deps", () => {
  it("flags a bare mutable global in a dependency array", () => {
    const result = runRule(
      noMutableInDeps,
      `
      function Page() {
        useEffect(() => {
          track(location.href);
        }, [location.href]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("location");
  });

  it("does not flag a prop that shadows a mutable global root", () => {
    const result = runRule(
      noMutableInDeps,
      `
      function Page({ location }) {
        useEffect(() => {
          track(location.pathname);
        }, [location.pathname]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a top-level `const location = useLocation()` rebinding", () => {
    const result = runRule(
      noMutableInDeps,
      `
      function Page() {
        const location = useLocation();
        useEffect(() => {
          track(location.pathname);
        }, [location.pathname]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot wave 4: a `const location` buried in a nested callback is a
  // different binding — it must NOT mask the browser global read in the
  // component's own dependency array.
  it("still flags a mutable global even when a nested scope reuses the name", () => {
    const result = runRule(
      noMutableInDeps,
      `
      function Page() {
        const onClick = () => {
          const location = computeLocation();
          return location.state;
        };
        useEffect(() => {
          track(location.href);
        }, [location.href]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("location");
  });
});
