import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPreventDefault } from "./no-prevent-default.js";

describe("correctness/no-prevent-default — regressions", () => {
  it("stays silent on a progressively-enhanced form with a native action", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() { return <form action="/submit" method="post" onSubmit={(e) => { e.preventDefault(); clientSubmit(); }}><button>Go</button></form>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an action-less form whose handler only does local work", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() { return <form onSubmit={(e) => { e.preventDefault(); setOpen(true); }}><button>Go</button></form>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
