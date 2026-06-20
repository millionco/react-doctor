import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnreleasedResource } from "./no-unreleased-resource.js";

const run = (code: string) => runRule(noUnreleasedResource, code, { filename: "fixture.tsx" });

describe("no-unreleased-resource", () => {
  it("flags a timer cleared inline on some paths but leaked on an early return", () => {
    const result = run(`
      function Component(flag) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          if (flag) {
            return;
          }
          clearInterval(id);
        }, []);
        return null;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an AbortController aborted on some paths but not all in useLayoutEffect", () => {
    const result = run(`
      function Component(flag) {
        useLayoutEffect(() => {
          const controller = new AbortController();
          if (flag) {
            return;
          }
          controller.abort();
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an event listener removed on some paths but not all", () => {
    const result = run(`
      function Component(flag) {
        useEffect(() => {
          target.addEventListener("click", handler);
          if (flag) {
            return;
          }
          target.removeEventListener("click", handler);
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inside a React.useEffect member call", () => {
    const result = run(`
      function Component(flag) {
        React.useEffect(() => {
          const id = setInterval(tick, 1000);
          if (flag) {
            return;
          }
          clearInterval(id);
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inside a useInsertionEffect callback", () => {
    const result = run(`
      function Component(flag) {
        useInsertionEffect(() => {
          const id = setInterval(tick, 1000);
          if (flag) {
            return;
          }
          clearInterval(id);
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a resource released on every path", () => {
    const result = run(`
      function Component(flag) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          if (flag) {
            clearInterval(id);
            return;
          }
          clearInterval(id);
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a resource released via try/finally", () => {
    const result = run(`
      function Component(flag) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          try {
            if (flag) {
              return;
            }
          } finally {
            clearInterval(id);
          }
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a resource that is never released (no intent to clean up)", () => {
    const result = run(`
      function Component() {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          return id;
        }, []);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a conditional add with a returned cleanup (remove on unmount)", () => {
    const result = run(`
      function Component({ show }) {
        useEffect(() => {
          if (show) {
            document.addEventListener('mousedown', handleClickOutside);
          } else {
            document.removeEventListener('mousedown', handleClickOutside);
          }
          return () => {
            document.removeEventListener('mousedown', handleClickOutside);
          };
        }, [show]);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag the remove-then-add idiom guarded by a returned cleanup", () => {
    const result = run(`
      function Component({ blobUrl }) {
        useEffect(() => {
          audioRef.current.removeEventListener('ended', handleEnded);
          audioRef.current.addEventListener('ended', handleEnded);
          return () => {
            audioRef.current.removeEventListener('ended', handleEnded);
          };
        }, [blobUrl]);
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a class lifecycle method that releases in a sibling method", () => {
    const result = run(`
      class Manager {
        attach(flag) {
          target.addEventListener("click", this.handler);
          if (flag) {
            return;
          }
          target.removeEventListener("click", this.handler);
        }
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a non-React framework effect (Solid createEffect)", () => {
    const result = run(`
      function Component(flag) {
        createEffect(() => {
          const id = setInterval(tick, 1000);
          if (flag) {
            return;
          }
          clearInterval(id);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does NOT flag a plain helper function outside any effect", () => {
    const result = run(`
      function start(flag) {
        const id = setInterval(tick, 1000);
        if (flag) {
          return;
        }
        clearInterval(id);
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });
});
