import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change reset-only siblings", () => {
  it.each([
    ["false", "false"],
    ["true", "true"],
    ["null", "null"],
    ["empty string", '""'],
    ["nonempty string", '"ready"'],
    ["zero", "0"],
    ["positive number", "7"],
  ])("allows an unguarded callback that only restores %s", (_label, resetValue) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [value, setValue] = useState(${resetValue});
        useEffect(() => { if (!visible) setValue(${resetValue}); }, [visible]);
        useEffect(() => register(() => setValue(${resetValue})), [register]);
        return visible && <button onClick={() => setValue("changed")}>{String(value)}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a mount effect", "useEffect(() => { setOpen(false); }, []);"],
    ["a cleanup", "useEffect(() => () => setOpen(false), []);"],
    [
      "an exposed inline handler",
      "const control = <button onClick={() => setOpen(false)}>Close</button>;",
    ],
    [
      "transparent wrappers",
      "useEffect(() => register(() => (setOpen)((false as boolean))), [register]);",
    ],
    [
      "a conditional reset callback",
      "useEffect(() => register(() => { if (visible) setOpen(false); }), [register, visible]);",
    ],
  ])("allows reset-only writes from %s", (_label, siblingBody) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) setOpen(false); }, [visible]);
        ${siblingBody}
        return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a different Boolean", "setOpen(true)"],
    ["a coerced literal", "setOpen(0)"],
    ["a functional updater", "setOpen(() => false)"],
    ["a state-reading updater", "setOpen(previous => !previous)"],
    ["a literal alias", "setOpen(resetValue)"],
    ["a call result", "setOpen(Boolean(0))"],
    ["an extra argument", "setOpen(false, true)"],
    ["a spread argument", "setOpen(...[false])"],
    ["a member call", "setOpen.call(null, false)"],
    ["a setter escape", "register(setOpen)"],
    ["a shadowed setter", "{ const setOpen = () => {}; setOpen(false); } setOpen(true)"],
  ])("keeps the warning for %s", (_label, writerBody) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [open, setOpen] = useState(false);
        const resetValue = false;
        useEffect(() => { if (!visible) setOpen(false); }, [visible]);
        useEffect(() => register(() => { ${writerBody}; }), [register]);
        return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a regex", "null", "/closed/"],
    ["a bigint", "null", "0n"],
    ["an object", "{}", "{}"],
    ["an array", "[]", "[]"],
    ["an implicit undefined", "", ""],
    ["a negative zero", "0", "-0"],
    ["a template string", '""', "``"],
  ])("does not treat %s as the same primitive reset", (_label, initialValue, siblingValue) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [value, setValue] = useState(${initialValue});
        useEffect(() => { if (!visible) setValue(${initialValue}); }, [visible]);
        useEffect(() => register(() => setValue(${siblingValue})), [register]);
        return visible && <output>{String(value)}</output>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "the focal reset is unguarded",
      "setOpen(false);",
      "visible && <output>{String(open)}</output>",
    ],
    [
      "the focal reset has the visible guard",
      "if (visible) setOpen(false);",
      "visible && <output>{String(open)}</output>",
    ],
    [
      "the focal guard is a disjunction",
      "if (!visible || enabled) setOpen(false);",
      "visible && <output>{String(open)}</output>",
    ],
    ["a state read is exposed", "if (!visible) setOpen(false);", "<output>{String(open)}</output>"],
    [
      "the guard has a different identity",
      "if (!enabled) setOpen(false);",
      "visible && <output>{String(open)}</output>",
    ],
  ])("does not relax the warning when %s", (_label, focalBody, renderExpression) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, enabled, register }: { visible: boolean; enabled: boolean; register: any }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { ${focalBody} }, [visible]);
        useEffect(() => register(() => setOpen(false)), [register]);
        return ${renderExpression};
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps an unguarded sibling warning with the same visibility dependency", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible }: { visible: boolean }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) setOpen(false); }, [visible]);
        useEffect(() => { setOpen(false); }, [visible]);
        return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
      };`,
      { forceJsx: true, includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5]);
  });

  it("compares reset literals only within the same setter binding", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [first, setFirst] = useState(false);
        const [second, setSecond] = useState(true);
        useEffect(() => { if (!visible) { setFirst(false); setSecond(true); } }, [visible]);
        useEffect(() => register(() => setFirst(true)), [register]);
        return visible && <output>{String(first)}{String(second)}</output>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows repeated matching focal and sibling resets", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) { setOpen(false); setOpen(false); } }, [visible]);
        useEffect(() => register(() => { setOpen(false); setOpen(false); }), [register]);
        return visible && <output>{String(open)}</output>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("leaves mixed focal writes outside the all-initial-value reset detector", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, register }: { visible: boolean; register: any }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) { setOpen(false); setOpen(true); } }, [visible]);
        useEffect(() => register(() => setOpen(false)), [register]);
        return visible && <output>{String(open)}</output>;
      };`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps the unrelated prop reset warning while allowing the guarded visibility reset", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, revision }: { visible: boolean; revision: number }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) setOpen(false); }, [visible]);
        useEffect(() => { setOpen(false); }, [revision]);
        return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
      };`,
      { forceJsx: true, includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5]);
  });

  it("keeps the visibility reset warning when a sibling can dirty hidden state", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Panel = ({ visible, revision }: { visible: boolean; revision: number }) => {
        const [open, setOpen] = useState(false);
        useEffect(() => { if (!visible) setOpen(false); }, [visible]);
        useEffect(() => { setOpen(true); }, [revision]);
        return visible && <button onClick={() => setOpen(true)}>{String(open)}</button>;
      };`,
      { forceJsx: true, includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4]);
  });
});
