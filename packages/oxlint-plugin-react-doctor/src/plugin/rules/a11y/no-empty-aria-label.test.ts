import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEmptyAriaLabel } from "./no-empty-aria-label.js";

describe("no-empty-aria-label", () => {
  it("flags a literal empty aria-label", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <IconButton aria-label="" />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty-string expression container", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <IconButton aria-label={""} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nullish fallback to empty string", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <IconButton aria-label={text ?? ""} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a logical-or fallback to empty string", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <IconButton aria-label={text || ""} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty aria-labelledby fallback", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <div aria-labelledby={id ?? ""} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty ternary consequent or alternate", () => {
    const alternate = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={cond ? label : ""} />;`
    );
    expect(alternate.diagnostics).toHaveLength(1);
    const consequent = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={cond ? "" : label} />;`
    );
    expect(consequent.diagnostics).toHaveLength(1);
  });

  it("flags case-insensitive attribute spelling", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button ARIA-LABEL="" />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through transparent wrappers", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={(text ?? "") as string} />;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a decorative empty alt", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <img alt="" src="x" />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an empty title prop", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <Tooltip title={text ?? ""} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-empty default fallback", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={text ?? defaultLabel} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-empty template literal", () => {
    const result = runRule(
      noEmptyAriaLabel,
      "const x = <button aria-label={`${prefix} item`} />;"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag aria-describedby fallback", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-describedby={x ?? ""} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier or call value", () => {
    const identifier = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={label} />;`
    );
    expect(identifier.diagnostics).toHaveLength(0);
    const call = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={getLabel()} />;`
    );
    expect(call.diagnostics).toHaveLength(0);
  });

  it("does not flag a logical-and expression to empty string", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={cond && ""} />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
