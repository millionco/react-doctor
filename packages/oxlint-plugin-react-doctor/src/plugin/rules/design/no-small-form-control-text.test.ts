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

  it("skips non-text inputs, custom controls, and dynamic sizes", () => {
    const result = runRule(
      noSmallFormControlText,
      `const Form = ({ className, fontSize, inputType, props }) => <><input type="hidden" className="text-xs" /><input type="checkbox" className="text-xs" /><input type={inputType} className="text-xs" /><Input className="text-xs" /><input className={className} style={{ fontSize }} /><input className="text-xs" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
