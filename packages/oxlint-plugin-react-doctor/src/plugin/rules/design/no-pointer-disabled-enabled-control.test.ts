import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPointerDisabledEnabledControl } from "./no-pointer-disabled-enabled-control.js";

describe("no-pointer-disabled-enabled-control", () => {
  it("reports pointer-disabled native controls", () => {
    const result = runRule(
      noPointerDisabledEnabledControl,
      `const Controls = () => (
        <>
          <button className="pointer-events-none">Save</button>
          <a href="/settings" className={'pointer-events-none'}>Settings</a>
          <input style={{ pointerEvents: "none" }} />
          <select style={{ ["pointerEvents"]: "none" }} />
          <textarea className={\`!pointer-events-none\`} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(5);
  });

  it("ignores elements that are not native focusable controls", () => {
    const result = runRule(
      noPointerDisabledEnabledControl,
      `const Examples = () => (
        <>
          <div className="pointer-events-none" />
          <a className="pointer-events-none">No destination</a>
          <input type="hidden" className="pointer-events-none" />
          <input type={"hidden"} style={{ pointerEvents: "none" }} />
          <section contentEditable className="pointer-events-none" />
          <Button className="pointer-events-none" />
          <my-button className="pointer-events-none" />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores controls explicitly removed from interaction", () => {
    const result = runRule(
      noPointerDisabledEnabledControl,
      `const Controls = () => (
        <>
          <button disabled className="pointer-events-none">Save</button>
          <button disabled={false} className="pointer-events-none">Save</button>
          <a href="/billing" aria-disabled="true" className="pointer-events-none">Billing</a>
          <a href="/billing" aria-disabled={false} className="pointer-events-none">Billing</a>
          <button inert className="pointer-events-none">Unavailable</button>
          <button hidden className="pointer-events-none">Hidden</button>
          <button tabIndex={-1} className="pointer-events-none">Programmatic</button>
          <button tabIndex="-1" style={{ pointerEvents: "none" }}>Programmatic</button>
          <button className="hidden pointer-events-none">Hidden</button>
          <button style={{ display: "none", pointerEvents: "none" }}>Hidden</button>
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores variant-scoped pointer disabling", () => {
    const result = runRule(
      noPointerDisabledEnabledControl,
      `const Controls = () => (
        <>
          <button className="sm:pointer-events-none">Responsive</button>
          <button className="disabled:pointer-events-none">Disabled state</button>
          <button className="hover:pointer-events-none">Hover state</button>
          <button className="supports-[display:grid]:pointer-events-none">Feature query</button>
          <button className="[&>svg]:pointer-events-none">Child icon</button>
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic, spread, and overridable class or style values", () => {
    const result = runRule(
      noPointerDisabledEnabledControl,
      `const Controls = ({ className, style, props, pointerEvents }) => (
        <>
          <button className={className}>Dynamic class</button>
          <button style={style}>Dynamic style</button>
          <button className="pointer-events-none" style={style}>Dynamic override</button>
          <button className={className} style={{ pointerEvents: "none" }}>Dynamic override</button>
          <button {...props} className="pointer-events-none">Spread props</button>
          <button style={{ ...style, pointerEvents: "none" }}>Spread style</button>
          <button style={{ pointerEvents }}>Dynamic pointer value</button>
          <button className="pointer-events-none" style={{ pointerEvents }}>Dynamic override</button>
          <button className="pointer-events-none" style={{ pointerEvents: "auto" }}>Inline override</button>
          <button style={{ pointerEvents: "auto" }}>Enabled</button>
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
