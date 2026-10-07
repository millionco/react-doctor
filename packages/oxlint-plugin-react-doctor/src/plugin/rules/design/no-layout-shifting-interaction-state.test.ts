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

  it("reports only effective interaction values that differ from the resting value", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="p-4 hover:p-6">Save</button><button className="p-4 hover:p-4">Cancel</button><button className="text-sm focus:text-lg">Help</button><button className="font-bold active:font-bold">More</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("normalizes equivalent static spacing and flex values", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="p-4 hover:p-[1rem]">Save</button><button className="grow-1 hover:grow">Cancel</button><button className="grow hover:grow-0">More</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the important tier for interaction and resting declarations", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="p-4 hover:!p-6 hover:p-8">Save</button><button className="!p-4 hover:p-6">Cancel</button><button className="!w-20 hover:!w-24">More</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for ambiguous interaction and resting declarations", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="p-4 hover:p-6 hover:p-8">Save</button><button className="p-4 hover:!p-6 hover:!p-8">Cancel</button><button className="p-4 p-6 hover:p-8">More</button></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("compares nested interaction scopes with the matching resting scope", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Actions = () => <><button className="p-4 md:p-6 md:hover:p-6">Save</button><button className="p-4 md:p-6 md:hover:p-8">Cancel</button><button className="p-4 dark:hover:p-4">More</button></>;`,
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

  it("does not treat arbitrary-value fragments as interaction utilities", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="before:content-['x hover:px-6']">Save</button>;`,
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

  it("stays quiet for unknown arbitrary geometry values", () => {
    const result = runRule(
      noLayoutShiftingInteractionState,
      `const Action = () => <button className="p-4 hover:p-[var(--interactive-space)] focus:w-[calc(100%-1rem)]">Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
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
