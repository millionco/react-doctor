import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPureBlackShadow } from "./no-pure-black-shadow.js";

describe("no-pure-black-shadow", () => {
  it("flags named, opaque, and translucent pure-black inline shadows", () => {
    const result = runRule(
      noPureBlackShadow,
      `const Cards = () => <><div style={{ boxShadow: "0 10px 30px black" }} /><div style={{ boxShadow: "0 10px 30px #000" }} /><div style={{ boxShadow: "0 8px 20px rgb(0 0 0 / 30%)" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags Tailwind black shadow colors and arbitrary shadows", () => {
    const result = runRule(
      noPureBlackShadow,
      `const Cards = () => <><div className="shadow-xl shadow-black" /><div className="shadow-xl shadow-black/20" /><div className="shadow-[0_20px_40px_#000]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("accepts transparent, neutral-tinted, and color-only shadow declarations", () => {
    const result = runRule(
      noPureBlackShadow,
      `const Cards = () => <><div style={{ boxShadow: "0 10px 30px #0000" }} /><div style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0)" }} /><div style={{ boxShadow: "0 10px 30px rgb(0 0 0 / 0%)" }} /><div style={{ boxShadow: "0 10px 30px #11182733" }} /><div className="shadow-black" /><div className="shadow-xl shadow-black/0" /><div className="shadow-xl shadow-black/[0%]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
