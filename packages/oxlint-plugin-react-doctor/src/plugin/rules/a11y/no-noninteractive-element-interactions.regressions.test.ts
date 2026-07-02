import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveElementInteractions } from "./no-noninteractive-element-interactions.js";

describe("a11y/no-noninteractive-element-interactions regressions", () => {
  it("exempts a handler on an element hidden from screen readers", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li aria-hidden="true" onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a handler on a visible non-interactive element", () => {
    const result = runRule(noNoninteractiveElementInteractions, `<li onClick={() => {}}>x</li>`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when every dynamic role branch is an interactive role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={cond ? "checkbox" : "radio"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot wave 4: a `&&` role short-circuits to `false` when the guard is
  // falsy, so the element is sometimes role-less — it must still be flagged.
  it("flags a `&&` role that can short-circuit to a non-role value", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={enabled && "button"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // …and a ternary whose alternate is `null` leaves the element role-less.
  it("flags a ternary role with a nullish branch", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={show ? "button" : null} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // `undefined` is an Identifier, not a Literal, so a bare `role={undefined}`
  // resolves to no role — the element is role-less and must still be flagged.
  it("flags a bare `role={undefined}`", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={undefined} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary role whose branch resolves to `undefined`", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={show ? "button" : undefined} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A genuinely opaque variable role stays silent — we can't prove it's
  // non-interactive, so it must NOT be flagged (guards against over-fixing).
  it("stays silent for an opaque variable role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={dynamicRole} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an opaque template-literal role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={\`list\${suffix}\`} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // PR #989 mined FP (ant-design ThemePicker.tsx / ColorPicker.tsx):
  // clicking a <label> forwards activation to its nested keyboard-accessible
  // input, and upstream jsx-a11y / oxc never flag <label> in this rule.
  it("stays silent for a <label onClick> wrapping a radio input", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<label onClick={() => onChange?.(theme)} className={styles.themeCard}>
        <input type="radio" name="theme" />
        <img draggable={false} src={src} alt={theme} />
      </label>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a bare <label onClick>", () => {
    const result = runRule(noNoninteractiveElementInteractions, `<label onClick={() => {}} />`);
    expect(result.diagnostics).toEqual([]);
  });

  // PR #989 mined FP (ant-design components/space/__tests__/index.test.tsx):
  // throwaway test JSX is not held to interactive-a11y standards.
  it("stays silent inside a testlike file", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<p onClick={() => setState((value) => value + 1)}>{state}</p>`,
      { filename: "/repo/components/space/__tests__/index.test.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags <p onClick> in a plain source file", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<p onClick={() => setState((value) => value + 1)}>{state}</p>`,
      { filename: "/repo/src/components/counter.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // jsx-a11y parity: <form> maps to the non-interactive `form` landmark
  // role, so the mined ant-design Actions.tsx submit-wrapper stays a TP.
  it("still flags a <form onClick> submit wrapper", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<form
        className="code-box-code-action"
        action="https://codesandbox.io/api/v1/sandboxes/define"
        method="POST"
        target="_blank"
        onClick={() => {
          track({ type: 'codesandbox', demo: assetId });
          formRef.current?.submit();
        }}
      >
        <input type="hidden" name="parameters" value={value} />
      </form>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // PR #989 fn-introduced: `void 0` always evaluates to `undefined`, so a
  // ternary branch of `void 0` leaves the element sometimes role-less.
  it("flags a ternary role with a `void 0` branch", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={show ? "button" : void 0} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // …and `??` (unlike `||`) lets a non-nullish falsy left pass through:
  // `false ?? "button"` renders role-less.
  it("flags a `??` role whose opaque left can pass through falsy", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={maybeFalse ?? "button"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary mixing an interactive and a non-interactive role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={cond ? "button" : "listitem"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `role={left || "button"}` when the left operand is opaque', () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={dynamicRole || "button"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary whose consequent is opaque even with an interactive fallback", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={cond ? dynamicRole : "button"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('stays silent on `role={"button" || fallback}` where the left always wins', () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={"button" || fallbackRole} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
