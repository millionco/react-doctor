import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSmallFormControlText } from "./no-small-form-control-text.js";

describe("no-small-form-control-text", () => {
  it("reports small inline form-control text", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input style={{ fontSize: 14 }} /><select style={{ fontSize: "0.875rem" }} /><textarea style={{ fontSize: "15px" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports small unvariant Tailwind text", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="text-sm sm:text-xs" /><textarea className="text-[15px] md:text-base" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports empty and invalid static input types because browsers treat them as text", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input type="" className="text-xs" /><input type="not-a-real-type" className="text-sm" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports statically omitted input types because browsers treat them as text", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input type={null} className="text-xs" /><input type={undefined} className="text-xs" /><input type={void 0} className="text-xs" /><input type={false} className="text-xs" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports authoritative static controls after a leading spread", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = ({ props }) => <><input {...props} style={{ color: "navy" }} type="email" className="text-xs" /><textarea {...props} style={{ color: "navy" }} className="text-sm" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows 16px and larger controls", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="text-base sm:text-sm" /><select style={{ fontSize: 16 }} /><textarea style={{ fontSize: "1rem" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors later base utilities and inline overrides", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="text-sm text-base" /><input className="text-sm" style={{ fontSize: 18 }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors important text-size precedence", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="!text-xs text-base" /><input className="text-xs !text-base text-xs" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects important Tailwind font sizes over inline styles", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="!text-xs" style={{ fontSize: 16 }} /><input className="!text-base" style={{ fontSize: 12 }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips non-text inputs, custom controls, and dynamic sizes", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = ({ className, fontSize, inputType, props }) => <><input type="hidden" className="text-xs" /><input type="checkbox" className="text-xs" /><input type={inputType} className="text-xs" /><Input className="text-xs" /><input className={className} style={{ fontSize }} /><input className="text-xs" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips controls hidden at mobile breakpoints", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><select className="hidden md:block text-xs" /><input className="hidden sm:block text-xs" /><textarea className="hidden lg:block text-sm" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips malformed arbitrary font sizes", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = () => <><input className="text-[..px]" /><input style={{ fontSize: "..px" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips unresolved inline style overrides", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = ({ styles, overrides }) => <><input className="text-xs" style={styles} /><input className="text-xs" style={{ color: "red", ...overrides }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
