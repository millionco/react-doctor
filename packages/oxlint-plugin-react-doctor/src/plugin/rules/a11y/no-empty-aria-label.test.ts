import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEmptyAriaLabel } from "./no-empty-aria-label.js";

describe("no-empty-aria-label", () => {
  it("flags a literal empty aria-label", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button aria-label="" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty-string expression container", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button aria-label={""} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nullish fallback to empty string on an interactive element", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button aria-label={text ?? ""} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a logical-or fallback to empty string on an interactive element", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <input aria-label={text || ""} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty aria-labelledby fallback on a landmark element", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <nav aria-labelledby={id ?? ""} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an empty ternary consequent or alternate", () => {
    const alternate = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={cond ? label : ""} />;`,
    );
    expect(alternate.diagnostics).toHaveLength(1);
    const consequent = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={cond ? "" : label} />;`,
    );
    expect(consequent.diagnostics).toHaveLength(1);
  });

  it("flags a fallback on a generic element with an explicit role", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <div role="img" aria-label={text ?? ""} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fallback on a generic element with an interaction handler", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <div onClick={open} aria-label={text ?? ""} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags case-insensitive attribute spelling", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button ARIA-LABEL="" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through transparent wrappers", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={(text ?? "") as string} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when aria-hidden is explicitly false", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-hidden={false} aria-label="" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an icon-library component suppressing its default label (rsuite SidenavToggle)", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <IconButton aria-label={expanded ? "Collapse" : "Expand"} icon={<ArrowLeftLineIcon aria-label="" />} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag any capitalized component, whose rendered semantics are unknown", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <Icon aria-label="" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an aria-hidden element, which is out of the accessibility tree", () => {
    const bare = runRule(noEmptyAriaLabel, `const x = <span aria-hidden aria-label="" />;`);
    expect(bare.diagnostics).toHaveLength(0);
    const literal = runRule(
      noEmptyAriaLabel,
      `const x = <span aria-hidden="true" aria-label="" />;`,
    );
    expect(literal.diagnostics).toHaveLength(0);
    const dynamic = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-hidden={isDecorative} aria-label="" />;`,
    );
    expect(dynamic.diagnostics).toHaveLength(0);
  });

  it("does not flag a presentational-role element", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <div role="presentation" aria-label="" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when text content provides the accessible name", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={ariaLabel ?? ""}>Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a sibling aria-labelledby provides the accessible name", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <input aria-label="" aria-labelledby="title-id" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a defensive fallback on a role-less generic element (text-reveal span)", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <span aria-label={text ?? ""} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a decorative empty alt", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <img alt="" src="x" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an empty title prop", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <Tooltip title={text ?? ""} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-empty default fallback", () => {
    const result = runRule(
      noEmptyAriaLabel,
      `const x = <button aria-label={text ?? defaultLabel} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-empty template literal", () => {
    const result = runRule(noEmptyAriaLabel, "const x = <button aria-label={`${prefix} item`} />;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag aria-describedby fallback", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button aria-describedby={x ?? ""} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier or call value", () => {
    const identifier = runRule(noEmptyAriaLabel, `const x = <button aria-label={label} />;`);
    expect(identifier.diagnostics).toHaveLength(0);
    const call = runRule(noEmptyAriaLabel, `const x = <button aria-label={getLabel()} />;`);
    expect(call.diagnostics).toHaveLength(0);
  });

  it("does not flag a logical-and expression to empty string", () => {
    const result = runRule(noEmptyAriaLabel, `const x = <button aria-label={cond && ""} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
