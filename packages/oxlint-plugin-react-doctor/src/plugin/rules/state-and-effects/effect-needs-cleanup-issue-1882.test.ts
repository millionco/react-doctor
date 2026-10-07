import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runEffectNeedsCleanup = (code: string) => runRule(effectNeedsCleanup, code);

describe("effect-needs-cleanup issue #1882", () => {
  it("accepts a guarded Promise timer that resets its own handle in its callback", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function probe(): Promise<boolean>;

      export function ResetsOwnHandle() {
        useEffect(() => {
          let disposed = false;
          let timer: ReturnType<typeof setTimeout> | undefined;

          void probe().then((online) => {
            if (disposed || online) return;
            timer = setTimeout(() => {
              timer = undefined;
            }, 1500);
          });

          return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
          };
        }, []);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a guarded Promise timer that resets its own handle to null in its callback", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function probe(): Promise<boolean>;

      export function ResetsOwnHandleToNull() {
        useEffect(() => {
          let disposed = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          void probe().then((online) => {
            if (disposed || online) return;
            timer = setTimeout(() => {
              timer = null;
            }, 1500);
          });

          return () => {
            disposed = true;
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a timer callback that reassigns the handle to a new timer without clearing", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function probe(): Promise<boolean>;

      export function UnsafeOverwrite() {
        useEffect(() => {
          let disposed = false;
          let timer: ReturnType<typeof setTimeout> | undefined;

          void probe().then((online) => {
            if (disposed || online) return;
            timer = setTimeout(() => {
              console.log("first");
            }, 1500);
            timer = setTimeout(() => {
              console.log("second");
            }, 2000);
          });

          return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
          };
        }, []);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts timer in Promise callback with disposal guard and inline reset", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function probe(): Promise<boolean>;

      export function InlineReset() {
        useEffect(() => {
          let disposed = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          void probe().then((online) => {
            if (disposed) return;
            if (!online && !timer) {
              timer = setTimeout(() => {
                timer = null;
              }, 1500);
            }
          });

          return () => {
            disposed = true;
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports timer without lifecycle guard after Promise", () => {
    const result = runEffectNeedsCleanup(`
      import { useEffect } from "react";

      declare function probe(): Promise<boolean>;

      export function NoGuard() {
        useEffect(() => {
          let timer: ReturnType<typeof setTimeout> | undefined;

          void probe().then((online) => {
            timer = setTimeout(() => {
              timer = undefined;
            }, 1500);
          });

          return () => {
            if (timer) clearTimeout(timer);
          };
        }, []);
        return null;
      }
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
