import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectCleanupNotOnEveryPath } from "./effect-cleanup-not-on-every-path.js";

const run = (code: string) =>
  runRule(effectCleanupNotOnEveryPath, code, { filename: "fixture.tsx" });

describe("effect-cleanup-not-on-every-path", () => {
  it("flags a listener acquired before an early bare return, with cleanup at the end", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ url, skip }) {
        useEffect(() => {
          const socket = new WebSocket(url);
          socket.addEventListener("message", handler);
          if (skip) return;
          return () => socket.removeEventListener("message", handler);
        });
        return null;
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });

  it("flags a timer leaked on a conditional early return", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ paused }) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          if (paused) {
            return;
          }
          return () => clearInterval(id);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setInterval");
  });

  it("flags when the early return is `return null`", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ enabled }) {
        useEffect(() => {
          const sub = store.subscribe(onChange);
          if (!enabled) return null;
          return () => sub.unsubscribe();
        });
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("subscribe");
  });

  it("stays quiet when the guard runs BEFORE the acquisition (cleanup post-dominates)", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ enabled }) {
        useEffect(() => {
          if (!enabled) return;
          const id = setInterval(tick, 1000);
          return () => clearInterval(id);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when there is no early return at all", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ url }) {
        useEffect(() => {
          const socket = new WebSocket(url);
          socket.addEventListener("message", handler);
          return () => socket.removeEventListener("message", handler);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when there is no cleanup at all (effect-needs-cleanup's job)", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ skip }) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          if (skip) return;
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when every early return path itself returns a cleanup", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ mode }) {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          if (mode) {
            return () => clearInterval(id);
          }
          return () => clearInterval(id);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when the acquisition is inside a nested handler (separate function)", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ skip }) {
        useEffect(() => {
          button.onclick = () => {
            const id = setInterval(tick, 1000);
          };
          if (skip) return;
          return () => teardown();
        });
        return null;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores non-effect hooks", () => {
    const result = run(`
      import { useMemo } from "react";
      function Component({ skip }) {
        const value = useMemo(() => {
          const id = setInterval(tick, 1000);
          if (skip) return;
          return () => clearInterval(id);
        }, [skip]);
        return value;
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags the acquisition leaked by a return nested in a branch after it", () => {
    const result = run(`
      import { useEffect } from "react";
      function Component({ a, b }) {
        useEffect(() => {
          window.addEventListener("resize", onResize);
          if (a) {
            if (b) {
              return;
            }
          }
          return () => window.removeEventListener("resize", onResize);
        });
        return null;
      }
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("addEventListener");
  });
});
