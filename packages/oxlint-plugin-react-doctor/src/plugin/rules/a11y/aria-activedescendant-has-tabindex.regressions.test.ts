import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { ariaActivedescendantHasTabindex } from "./aria-activedescendant-has-tabindex.js";

describe("a11y/aria-activedescendant-has-tabindex regressions", () => {
  // Docs-validation FP (cloudscape prompt-input token-mode): a
  // contentEditable editing host is natively focusable/tabbable, so it
  // doesn't need an explicit tabIndex.
  it('stays silent on a contentEditable="true" role=textbox div', () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div role="textbox" contentEditable="true" aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a bare contentEditable shorthand", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when contentEditable is a runtime conditional", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div role="textbox" contentEditable={disabled ? 'false' : 'true'} aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a contentEditable="false" div without tabIndex', () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable="false" aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a contentEditable={false} div without tabIndex", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable={false} aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a const-disabled editing host", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `const editable = false;
      <div contentEditable={editable} aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags invalid inherited contentEditable values", () => {
    const sources = [
      `<div contentEditable="inherit" aria-activedescendant={activeId} />`,
      `<div contentEditable="invalid" aria-activedescendant={activeId} />`,
      `<div contentEditable><div contentEditable="inherit" aria-activedescendant={activeId} /></div>`,
    ];
    for (const source of sources) {
      expect(runRule(ariaActivedescendantHasTabindex, source).diagnostics).toHaveLength(1);
    }
  });

  it("still flags a nested enabled editing host", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable>
        <div contentEditable aria-activedescendant={activeId} />
      </div>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not assume a dynamic editing ancestor is always enabled", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable={outerEnabled}>
        <div contentEditable aria-activedescendant={activeId} />
      </div>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not look past uncertain or disabled editing-host boundaries", () => {
    const sources = [
      `<div contentEditable>
        <div contentEditable={false}>
          <div contentEditable aria-activedescendant={activeId} />
        </div>
      </div>`,
      `<div contentEditable>
        <div contentEditable={innerEnabled}>
          <div contentEditable aria-activedescendant={activeId} />
        </div>
      </div>`,
      `<div contentEditable>
        <Wrapper>
          <div contentEditable aria-activedescendant={activeId} />
        </Wrapper>
      </div>`,
    ];
    for (const source of sources) {
      expect(runRule(ariaActivedescendantHasTabindex, source).diagnostics).toEqual([]);
    }
  });

  it("still flags a plain div with aria-activedescendant and no tabIndex", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
