import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change with projected dependencies", () => {
  it("retains a classic script whose global callback binding can be replaced", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      function scroll() {}
      function getFields({ label }) { return { label, action: scroll }; }
      function Disclosure({ label }) {
        const [expanded, setExpanded] = React.useState(false);
        globalThis.scroll = () => label;
        const { action } = getFields({ label });
        React.useEffect(() => {
          setExpanded(true);
          action();
        }, [action]);
        return <div>{expanded}</div>;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      description: "a stable module binding",
      fields: "({ label }) => ({ label, action: scroll })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 0,
    },
    {
      description: "a stable callback passed through the factory",
      fields: "({ label, focus }) => ({ label, action: focus })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 0,
    },
    {
      description: "a callback that changes with a prop",
      fields: "({ label, focus }) => ({ label, action: focus })",
      callbackDependencies: "[label]",
      effectDependencies: "action",
      warnings: 1,
    },
    {
      description: "a separate prop dependency",
      fields: "({ label }) => ({ label, action: scroll })",
      callbackDependencies: "[]",
      effectDependencies: "action, label",
      warnings: 1,
    },
    {
      description: "a function selected by a prop",
      fields: "({ label, focus }) => ({ action: label ? scroll : focus })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 1,
    },
    {
      description: "a later dynamic property",
      fields: "({ label, focus }) => ({ action: scroll, [label]: focus })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 1,
    },
    {
      description: "a parameter default that changes the selected callback",
      fields: "({ focus, other = (focus = () => {}) }) => ({ action: focus })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 1,
    },
    {
      description: "a direct eval that can rebind the projected callback",
      fields: '({ label }) => ({ label: ((eval)("scroll = () => {}"), label), action: scroll })',
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 1,
    },
    {
      description: "a fresh function",
      fields: "({ label }) => ({ label, action: () => scroll() })",
      callbackDependencies: "[]",
      effectDependencies: "action",
      warnings: 1,
    },
  ])("$description", ({ fields, callbackDependencies, effectDependencies, warnings }) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `
      import { useCallback, useEffect, useRef, useState } from "preact/hooks";
      const scroll = () => {};
      const getFields = ${fields};

      export const Disclosure = ({ label }) => {
        const inputRef = useRef(null);
        const [expanded, setExpanded] = useState(false);
        const focus = useCallback(() => inputRef.current?.focus(), ${callbackDependencies});
        const { action } = getFields({ label, focus });
        useEffect(() => {
          setExpanded(true);
          action();
        }, [${effectDependencies}]);
        return <input ref={inputRef} aria-expanded={expanded} aria-label={label} />;
      };
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(warnings);
  });
});
