import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderDerivedStateFromHook } from "./rerender-derived-state-from-hook.js";

describe("performance/rerender-derived-state-from-hook — regressions", () => {
  it("stays silent when the continuous value is itself rendered", () => {
    const result = runRule(
      rerenderDerivedStateFromHook,
      `function App() { const width = useWindowWidth(); const isMobile = width < 768; return <div>{width}px {isMobile ? "m" : "d"}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when only the threshold boolean is used in render", () => {
    const result = runRule(
      rerenderDerivedStateFromHook,
      `function App() { const width = useWindowWidth(); const isMobile = width < 768; return <div>{isMobile ? "m" : "d"}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the multi-breakpoint pattern where every read is a threshold comparison", () => {
    const result = runRule(
      rerenderDerivedStateFromHook,
      `function App() { const width = useWindowWidth(); const isMobile = width < 768; const isDesktop = width > 1024; return <div>{isMobile ? "m" : isDesktop ? "d" : "t"}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a multi-breakpoint component also reads the raw value elsewhere", () => {
    const result = runRule(
      rerenderDerivedStateFromHook,
      `function App() { const width = useWindowWidth(); const isMobile = width < 768; const isDesktop = width > 1024; return <div style={{ width }}>{isMobile ? "m" : isDesktop ? "d" : "t"}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
