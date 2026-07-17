import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noClippedOverlay } from "./no-clipped-overlay.js";

describe("no-clipped-overlay", () => {
  it("flags an absolute menu inside overflow hidden", () => {
    const result = runRule(
      noClippedOverlay,
      `const Example = () => <div className="overflow-hidden"><div role="menu" className="absolute top-full">Menu</div></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags nested clipping ancestors", () => {
    const result = runRule(
      noClippedOverlay,
      `const Example = () => <section className="overflow-clip"><div><div role="tooltip" className="absolute">Tip</div></div></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag ordinary decorative absolute children", () => {
    const result = runRule(
      noClippedOverlay,
      `const Example = () => <div className="overflow-hidden"><div className="absolute inset-0" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag overlays outside clipping containers", () => {
    const result = runRule(
      noClippedOverlay,
      `const Example = () => <div><div role="listbox" className="absolute">Options</div></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat variant-only overflow as base clipping", () => {
    const result = runRule(
      noClippedOverlay,
      `const Example = () => <div className="md:overflow-hidden"><div role="menu" className="absolute">Menu</div></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
