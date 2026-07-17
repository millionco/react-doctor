import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEmptyCardShell } from "./no-empty-card-shell.js";

describe("no-empty-card-shell", () => {
  it("flags an empty bordered semantic card", () => {
    const result = runRule(
      noEmptyCardShell,
      `const Empty = () => <section className="rounded-xl border bg-white p-6" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a card with content", () => {
    const result = runRule(
      noEmptyCardShell,
      `const Card = () => <section className="rounded-xl border p-6"><h2>Activity</h2></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts skeletons and purposeful widget containers", () => {
    const result = runRule(
      noEmptyCardShell,
      `const Loading = () => <><section className="animate-pulse rounded-xl border p-6" /><aside role="status" className="rounded-xl border p-6" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores empty elements without a complete card treatment", () => {
    const result = runRule(
      noEmptyCardShell,
      `const Layout = () => <><section className="p-6" /><section className="rounded-xl border" /><div className="rounded-xl border p-6" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
