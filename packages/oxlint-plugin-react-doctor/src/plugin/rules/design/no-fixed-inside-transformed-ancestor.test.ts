import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFixedInsideTransformedAncestor } from "./no-fixed-inside-transformed-ancestor.js";

describe("no-fixed-inside-transformed-ancestor", () => {
  it("reports fixed descendants of transformed intrinsic ancestors", () => {
    const result = runRule(
      noFixedInsideTransformedAncestor,
      `const Overlay = () => <><div className="translate-x-0"><div className="fixed inset-0" /></div><section style={{ transform: "translateZ(0)" }}><aside style={{ position: "fixed" }} /></section></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows viewport-fixed siblings and absolute descendants", () => {
    const result = runRule(
      noFixedInsideTransformedAncestor,
      `const Overlay = () => <><div className="transform" /><div className="fixed inset-0" /><div className="scale-95"><div className="absolute inset-0" /></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows inert transform declarations", () => {
    const result = runRule(
      noFixedInsideTransformedAncestor,
      `const Overlay = () => <><div className="transform-none"><div className="fixed" /></div><div style={{ transform: "none", filter: "none" }}><div style={{ position: "fixed" }} /></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips variant-only transforms, custom ancestors, and spreads", () => {
    const result = runRule(
      noFixedInsideTransformedAncestor,
      `const Overlay = ({ props }) => <><div className="hover:scale-95"><div className="fixed" /></div><Panel className="scale-95"><div className="fixed" /></Panel><div className="scale-95" {...props}><div className="fixed" /></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
