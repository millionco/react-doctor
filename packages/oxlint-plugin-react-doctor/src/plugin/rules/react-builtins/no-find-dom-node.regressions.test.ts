import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFindDomNode } from "./no-find-dom-node.js";

describe("react-builtins/no-find-dom-node — regressions", () => {
  // A locally defined `findDOMNode` helper is not React's API, so the
  // bare-identifier form must only fire when imported from react-dom.
  it("stays silent on a local findDOMNode helper", () => {
    const result = runRule(
      noFindDomNode,
      `function findDOMNode(sel) { return document.querySelector(sel); } export const f = () => findDOMNode(".x");`,
      { filename: "helper.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags bare findDOMNode imported from react-dom", () => {
    const result = runRule(
      noFindDomNode,
      `import { findDOMNode } from "react-dom"; export const f = (node) => findDOMNode(node);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
