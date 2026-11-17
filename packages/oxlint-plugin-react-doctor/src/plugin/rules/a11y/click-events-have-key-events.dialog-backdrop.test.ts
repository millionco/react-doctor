import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

const EXAMPLE = `
  import { useCallback, useState, useRef } from "react";
  import { createPortal as mount } from "react-dom";
  export const Preview = ({ ready, alternate }) => {
    const [selected, setSelected] = useState(null);
    const panel = useRef(null);
    const dismiss = useCallback(() => setSelected(null), []);
    const overlay = (
      <div aria-hidden={!selected} className={\`fixed \${selected ? "block" : "hidden"}\`}>
        <div onClick={dismiss} />
        <div ref={panel} role="dialog" aria-modal="true"
          className={\`relative \${selected ? "translate-y-0" : "translate-y-full"}\`}>
          <div className="flex">
            <button onClick={dismiss}>Dismiss preview</button>
          </div>
        </div>
      </div>
    );
    return <div>
      <button type="button" onClick={() => setSelected("preview")}>Preview</button>
      {ready && mount(overlay, document.body)}
    </div>;
  };
`;

describe("click-events-have-key-events dialog backdrops", () => {
  it("accepts a body portal with an always-available button for the same dismissal", () => {
    const result = runRule(clickEventsHaveKeyEvents, EXAMPLE);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a different callback", "<button onClick={dismiss}>", "<button onClick={alternate}>"],
    [
      "an imperatively hidden dialog",
      "const panel = useRef(null);",
      "const panel = useRef(null); useEffect(() => { if (panel.current) panel.current.inert = true; }, [selected]);",
    ],
    ["a ref on the button", "<button onClick={dismiss}>", "<button ref={panel} onClick={dismiss}>"],
    [
      "a nested interactive element",
      "Dismiss preview</button>",
      "Dismiss <a href='#'>preview</a></button>",
    ],
    [
      "a native keyboard blocker",
      "const panel = useRef(null);",
      'const panel = useRef(null); window.addEventListener("keydown", (event) => event.preventDefault());',
    ],
    ["inline CSS with unknown effect", "return <div>", "return <div><style>{alternate}</style>"],
    ["a hidden button", "<button onClick={dismiss}>", "<button hidden onClick={dismiss}>"],
    ["a disabled button", "<button onClick={dismiss}>", "<button disabled onClick={dismiss}>"],
    ["a submit button", "<button onClick={dismiss}>", '<button type="submit" onClick={dismiss}>'],
    [
      "a button outside the tab sequence",
      "<button onClick={dismiss}>",
      "<button tabIndex={-1} onClick={dismiss}>",
    ],
    [
      "a conditionally mounted button",
      "<button onClick={dismiss}>Dismiss preview</button>",
      "{alternate && <button onClick={dismiss}>Dismiss preview</button>}",
    ],
    [
      "a button styled out of sight",
      "<button onClick={dismiss}>",
      '<button className="md:invisible" onClick={dismiss}>',
    ],
    [
      "a custom ancestor",
      '<div className="flex">\n            <button onClick={dismiss}>Dismiss preview</button>\n          </div>',
      "<Wrapper><button onClick={dismiss}>Dismiss preview</button></Wrapper>",
    ],
    ["an inert ancestor", '<div className="flex">', '<div className="flex" inert>'],
    [
      "a disabled fieldset",
      '<div className="flex">\n            <button onClick={dismiss}>Dismiss preview</button>\n          </div>',
      "<fieldset disabled><button onClick={dismiss}>Dismiss preview</button></fieldset>",
    ],
    ["unresolved props", "<button onClick={dismiss}>", "<button onClick={dismiss} {...alternate}>"],
    [
      "an extra backdrop action",
      "<div onClick={dismiss} />",
      "<div onClick={dismiss} onPointerDown={alternate} />",
    ],
    [
      "a dialog capture handler",
      'ref={panel} role="dialog"',
      'ref={panel} onClickCapture={alternate} role="dialog"',
    ],
    ["a key blocker in the portal owner", "return <div>", "return <div onKeyDown={alternate}>"],
    [
      "an event-sensitive dismiss callback",
      "() => setSelected(null), []",
      "(event) => event.target && setSelected(null), []",
    ],
    [
      "a non-React state setter",
      "const [selected, setSelected] = useState(null);",
      "const [selected, setSelected] = alternate(null);",
    ],
    [
      "a different state controlling visibility",
      "aria-hidden={!selected}",
      "aria-hidden={!alternate}",
    ],
    ["a dynamic destination", "mount(overlay, document.body)", "mount(overlay, alternate)"],
    [
      "a shadowed DOM global",
      "const panel = useRef(null);",
      "const document = alternate; const panel = useRef(null);",
    ],
    ["a non-React portal", 'from "react-dom"', 'from "./portal"'],
    ["a nonmodal sibling", 'aria-modal="true"', 'aria-modal="false"'],
    [
      "an overlay reused elsewhere",
      "{ready && mount(overlay, document.body)}",
      "{overlay}{ready && mount(overlay, document.body)}",
    ],
  ])("keeps the warning with %s", (_reason, source, replacement) => {
    expect(EXAMPLE).toContain(source);
    const result = runRule(clickEventsHaveKeyEvents, EXAMPLE.replace(source, replacement));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
