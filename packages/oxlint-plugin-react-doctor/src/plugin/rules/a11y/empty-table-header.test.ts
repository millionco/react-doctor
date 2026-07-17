import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { emptyTableHeader } from "./empty-table-header.js";

describe("empty-table-header", () => {
  it("reports empty native and ARIA table headers", () => {
    const result = runRule(
      emptyTableHeader,
      `const Table = () => <table><tbody><tr><th /><td role="columnheader" /></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts text, dynamic content, and explicit accessible names", () => {
    const result = runRule(
      emptyTableHeader,
      `const Table = ({ name }) => <table><tbody><tr><th>Name</th><th>{name}</th><th aria-label="Status" /></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports an explicitly empty aria-label", () => {
    const result = runRule(emptyTableHeader, `const Table = () => <th aria-label="" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer rendered semantics for a custom component", () => {
    const result = runRule(emptyTableHeader, `const Table = () => <Cell role="columnheader" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
