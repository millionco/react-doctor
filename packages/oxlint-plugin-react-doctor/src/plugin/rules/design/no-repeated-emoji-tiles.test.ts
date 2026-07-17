import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedEmojiTiles } from "./no-repeated-emoji-tiles.js";

describe("no-repeated-emoji-tiles", () => {
  it("flags repeated emoji tiles used as feature icons", () => {
    const result = runRule(
      noRepeatedEmojiTiles,
      `const Page = () => <main><span className="size-12 rounded-xl bg-blue-100">🚀</span><span className="size-12 rounded-xl bg-green-100">🔒</span><span className="size-12 rounded-xl bg-amber-100">⚡</span></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an isolated emoji and unboxed prose emoji", () => {
    const result = runRule(
      noRepeatedEmojiTiles,
      `const Page = () => <main><span className="size-12 rounded-xl bg-blue-100">🚀</span><p>Fast ⚡</p><p>Safe 🔒</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat one-axis sizing as an icon tile", () => {
    const result = runRule(
      noRepeatedEmojiTiles,
      `const Page = () => <main><span className="h-12 rounded-xl bg-blue-100">🚀</span><span className="h-12 rounded-xl bg-green-100">🔒</span><span className="h-12 rounded-xl bg-amber-100">⚡</span></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
