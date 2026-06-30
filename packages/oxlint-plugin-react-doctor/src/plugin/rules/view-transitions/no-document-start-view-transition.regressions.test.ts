import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDocumentStartViewTransition } from "./no-document-start-view-transition.js";

describe("view-transitions/no-document-start-view-transition regressions", () => {
  it("exempts a locally-bound `document` (parameter shadows the global)", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `function f(document){ document.startViewTransition(() => {}); }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags the global `document.startViewTransition(...)`", () => {
    const result = runRule(
      noDocumentStartViewTransition,
      `document.startViewTransition(() => {});`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
