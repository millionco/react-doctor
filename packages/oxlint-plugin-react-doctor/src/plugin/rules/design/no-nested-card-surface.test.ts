import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNestedCardSurface } from "./no-nested-card-surface.js";

describe("no-nested-card-surface", () => {
  it("flags a complete card surface nested in another card", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6"><section className="rounded-lg border bg-white p-4">Inner</section></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a flat inner group", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6"><section className="border-t pt-4">Inner</section></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer card styling from dynamic classes", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = ({ outer, inner }) => <div className={outer}><section className={inner}>Inner</section></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assemble a nested card from conditional utilities", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6"><section className="rounded-lg dark:border bg-white p-4">Inner</section></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
