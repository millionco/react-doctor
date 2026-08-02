import { describe, expect, it } from "vite-plus/test";
import { resolveVisibleStart } from "../../src/cli/utils/resolve-visible-start.js";

describe("resolveVisibleStart", () => {
  it("clamps stale offsets after the viewport grows", () => {
    expect(
      resolveVisibleStart({ itemCount: 10, offset: 8, selectedIndex: 9, viewportHeight: 6 }),
    ).toBe(4);
  });

  it("scrolls upward to keep the selected item visible", () => {
    expect(
      resolveVisibleStart({ itemCount: 20, offset: 8, selectedIndex: 3, viewportHeight: 5 }),
    ).toBe(3);
  });

  it("scrolls downward to keep the selected item visible", () => {
    expect(
      resolveVisibleStart({ itemCount: 20, offset: 2, selectedIndex: 12, viewportHeight: 5 }),
    ).toBe(8);
  });

  it("returns the first row when no rows fit", () => {
    expect(
      resolveVisibleStart({ itemCount: 20, offset: 8, selectedIndex: 12, viewportHeight: 0 }),
    ).toBe(0);
  });
});
