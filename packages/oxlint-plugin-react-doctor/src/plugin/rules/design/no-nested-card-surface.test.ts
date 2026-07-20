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

  it("does not treat controls or code blocks as nested cards", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6">
        <button className="rounded-lg border bg-white p-4">Save</button>
        <code className="rounded-lg border bg-white p-4">npm run build</code>
      </div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat fixed-size icon tiles as nested cards", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6">
        <div className="flex size-10 items-center justify-center rounded-full border bg-white"><Icon /></div>
      </div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat compact chips or control groups as nested cards", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6">
        <div className="rounded-lg border bg-white p-0.5">Controls</div>
        <div className="rounded-md border bg-white p-1.5">Icon</div>
        <div className="rounded-full border bg-white px-2 py-1">Badge</div>
      </div>;`,
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

  it("ignores inner surfaces with non-drawing boundary utilities", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6">
        <section className="rounded-lg border-0 p-4">Zero border</section>
        <section className="rounded-lg border-solid p-4">Style only</section>
        <section className="rounded-lg shadow-none p-4">No shadow</section>
        <section className="rounded-lg ring-0 p-4">No ring</section>
      </div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes card interiors with physical padding utilities", () => {
    const result = runRule(
      noNestedCardSurface,
      `const Example = () => <div className="rounded-xl border p-6"><section className="rounded-lg border pt-4">Inner</section></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
