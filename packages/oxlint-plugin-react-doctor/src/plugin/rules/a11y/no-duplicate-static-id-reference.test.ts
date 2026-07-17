import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDuplicateStaticIdReference } from "./no-duplicate-static-id-reference.js";

describe("no-duplicate-static-id-reference", () => {
  it("reports duplicated IDs used by labels or ARIA", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const Form = () => <><label htmlFor="email">Email</label><input id="email" /><input id="email" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores unreferenced duplicate IDs", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = () => <div><span id="item" /><span id="item" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not compare conditional branches or dynamic IDs", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = ({ active, id }) => <div aria-labelledby="item">{active ? <span id="item" /> : <span id="item" />}<span id={id} /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer DOM references from custom-component props", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = () => <><Custom aria-labelledby="item" /><span id="item" /><span id="item" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
