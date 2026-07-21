import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInvisibleFocusControl } from "./no-invisible-focus-control.js";

describe("no-invisible-focus-control", () => {
  it("reports a transparent native select without a focus proxy", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Timezone = () => <div className="relative"><select className="absolute inset-0 h-full w-full cursor-pointer opacity-0"><option>UTC</option></select><span>UTC</span></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a self reveal or an ancestor focus-within indicator", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-0 focus-visible:opacity-100" /><label className="relative focus-within:ring-2"><input className="absolute opacity-0" /><span>Upload</span></label></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the focus state to restore the property that hides the control", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="invisible focus-visible:opacity-100" /><select className="opacity-0 focus-visible:visible" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes arbitrary zero opacity and arbitrary focus restoration", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-[0]" /><select className="opacity-[0%] focus:opacity-[.5]" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not mistake ring offsets or transparent borders for focus indicators", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><label className="focus-within:ring-offset-2"><select className="opacity-0" /></label><label className="focus-within:border-transparent"><select className="opacity-0" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains when equal-priority base visibility utilities conflict", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-0 opacity-100" /><select className="invisible visible" /><select className="opacity-100 opacity-0" /><select className="visible invisible" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important base visibility utilities independently of class order", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-100 !opacity-0" /><select className="!opacity-0 opacity-100" /><select className="opacity-0 !opacity-100" /><select className="!opacity-100 opacity-0" /><select className="visible invisible!" /><select className="invisible! visible" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("does not accept conflicting focus reveal utilities", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-0 focus:opacity-100 focus:opacity-0" /><select className="invisible focus:visible focus:invisible" /><select className="opacity-0 focus:!opacity-100 focus:!opacity-0" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("honors important focus reveal utilities independently of class order", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><select className="opacity-0 focus:opacity-100 focus:!opacity-0" /><select className="opacity-0 focus:!opacity-0 focus:opacity-100" /><select className="opacity-0 focus:opacity-0 focus:!opacity-100" /><select className="opacity-0 focus:!opacity-100 focus:opacity-0" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows a visible indicator on a later peer sibling", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><label><input className="peer opacity-0" /><span className="peer-focus-visible:ring-2">Upload</span></label><label><input className="peer/upload opacity-0" /><span className="peer-focus-visible/upload:outline">Upload</span></label></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a peer marker and a visible peer indicator", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><label><input className="opacity-0" /><span className="peer-focus-visible:ring-2">Upload</span></label><label><input className="peer opacity-0" /><span className="peer-focus-visible:ring-0">Upload</span></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not accept conflicting ancestor or peer focus indicators", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = () => <><label className="focus-within:ring-2 focus-within:ring-0"><input className="opacity-0" /></label><label><input className="peer opacity-0" /><span className="peer-focus:ring-2 peer-focus:ring-0">Upload</span></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips non-focusable elements, disabled controls, dynamic classes, and spreads", () => {
    const result = runRule(
      noInvisibleFocusControl,
      `const Controls = ({ className, props }) => <><div className="opacity-0" /><select disabled className="opacity-0" /><select className={className} /><select className="opacity-0" {...props} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
