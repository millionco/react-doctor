import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRedundantTitleTooltip } from "./no-redundant-title-tooltip.js";

describe("no-redundant-title-tooltip", () => {
  it("flags a title that repeats visible button text", () => {
    const result = runRule(
      noRedundantTitleTooltip,
      `const Save = () => <button title="Save changes">Save changes</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("normalizes casing and whitespace", () => {
    const result = runRule(
      noRedundantTitleTooltip,
      `const Docs = () => <a title={"read docs"}> Read   Docs </a>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts supplementary and icon-only titles", () => {
    const result = runRule(
      noRedundantTitleTooltip,
      `const Actions = () => <><button title="Saves your draft">Save</button><button title="Delete"><Trash /></button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts titles that expose truncated text", () => {
    const result = runRule(
      noRedundantTitleTooltip,
      `const Item = () => <button className="truncate" title="A very long project name">A very long project name</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
