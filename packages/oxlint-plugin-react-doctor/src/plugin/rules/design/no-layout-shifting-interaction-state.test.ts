import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLayoutShiftingInteractionState } from "./no-layout-shifting-interaction-state.js";

describe("no-layout-shifting-interaction-state", () => {
  it("reports geometry-changing interaction utilities", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="hover:px-6">Save</button><a className="focus-visible:font-bold">Docs</a><div className="active:h-12" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports responsive and group interaction variants", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="md:hover:text-lg">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows paint-only and transform feedback", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="hover:bg-blue-600 hover:shadow-md active:scale-95 focus-visible:ring-2">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows arbitrary color feedback", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="text-[var(--muted)] hover:text-[var(--foreground)]">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports arbitrary font-size feedback with a concrete length", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="hover:text-[1.125rem]">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows non-interaction responsive geometry", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="px-4 md:px-6 text-sm md:text-base">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic class names", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = ({ className }) => <button className={className}>Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
