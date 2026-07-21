import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFocusableContentInAriaHidden } from "./no-focusable-content-in-aria-hidden.js";

describe("no-focusable-content-in-aria-hidden", () => {
  it("reports native and explicitly focusable descendants", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <div aria-hidden="true"><button type="button">Save</button><span tabIndex={0}>More</span></div>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports boolean shorthand and nested fragments", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <section aria-hidden><><a href="/help">Help</a></></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows descendants removed from focus order", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <div aria-hidden><button disabled type="button">Save</button><a href="/" tabIndex={-1}>Home</a><input type="hidden" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic, overridden, and custom hidden ancestors", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = ({ hidden, props }) => <><div aria-hidden={hidden}><button type="button">A</button></div><div aria-hidden {...props}><button type="button">B</button></div><Panel aria-hidden><button type="button">C</button></Panel></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows focusable descendants in Bootstrap-managed modal markup", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Modals = () => <><div className="modal fade" aria-hidden="true"><button type="button" data-bs-dismiss="modal">Close</button><input /></div><div className="modal fade" aria-hidden="true"><button type="button" data-dismiss="modal">Close</button><a href="/confirm">Confirm</a></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports ordinary aria-hidden containers with data attributes", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <><div aria-hidden="true"><button type="button" data-bs-dismiss="modal">Close</button></div><div className="modal-card" aria-hidden="true"><a href="/confirm">Confirm</a><button type="button" data-bs-dismiss="modal">Close</button></div><div className="md:modal" aria-hidden="true"><button type="button" data-bs-dismiss="modal">Close</button></div></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("does not treat arbitrary-value fragments as hiding utilities", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <div aria-hidden><button className="[--state:x hidden y]">Save</button></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat arbitrary-value fragments as Bootstrap modal markers", () => {
    const result = runRule(
      noFocusableContentInAriaHidden,
      `const Hidden = () => <div className="[--dialog:x modal y]" aria-hidden><button data-bs-dismiss="modal">Close</button></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
