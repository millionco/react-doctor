import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

const timeoutToggle = `
import { useLayoutEffect, useState } from "react";

const Indicator = () => {
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    const timer = window.setTimeout(() => setVisible(!visible), 100);
    return () => window.clearTimeout(timer ?? undefined);
  }, [visible]);
  return <span>{visible ? "On" : "Off"}</span>;
};
`;

describe("nullish timeout cleanup for Boolean toggles", () => {
  it.each([
    ["window timeout", timeoutToggle],
    ["bare timeout", timeoutToggle.replaceAll("window.", "")],
    ["globalThis timeout", timeoutToggle.replaceAll("window.", "globalThis.")],
    ["literal void fallback", timeoutToggle.replace("?? undefined", "?? (void 0)")],
    [
      "braced cleanup",
      timeoutToggle.replace(
        "return () => window.clearTimeout(timer ?? undefined);",
        "return () => { window.clearTimeout(timer ?? undefined); };",
      ),
    ],
  ])("accepts a direct native %s", (_description, source) => {
    const result = runRule(noBooleanToggleWithoutFunctionalUpdate, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "missing cleanup",
      timeoutToggle.replace(/    return \(\) => window\.clearTimeout[^\n]+\n/, ""),
    ],
    ["missing state dependency", timeoutToggle.replace("[visible]", "[]")],
    ["mutable handle", timeoutToggle.replace("const timer", "let timer")],
    [
      "setter exposed to another callback",
      timeoutToggle.replace("return <span>", "return <span onClick={setVisible}>"),
    ],
    [
      "another argument to the setter",
      timeoutToggle.replace("setVisible(!visible)", "setVisible(!visible, inspect())"),
    ],
    ["wrong handle", timeoutToggle.replace("timer ?? undefined", "1 ?? undefined")],
    ["truthy fallback", timeoutToggle.replace("?? undefined", "|| undefined")],
    ["custom fallback", timeoutToggle.replace("?? undefined", "?? otherTimer")],
    [
      "shadowed undefined",
      timeoutToggle.replace("const Indicator = ()", "const Indicator = (undefined)"),
    ],
    [
      "conditional cleanup",
      timeoutToggle.replace("() => window.clearTimeout", "() => visible && window.clearTimeout"),
    ],
    ["optional cleanup", timeoutToggle.replace("clearTimeout(", "clearTimeout?.(")],
    ["extra cleanup argument", timeoutToggle.replace("?? undefined)", "?? undefined, inspect())")],
    ["different receiver", timeoutToggle.replace("window.clearTimeout", "self.clearTimeout")],
    ["nonliteral delay", timeoutToggle.replace(", 100)", ", delay)")],
    [
      "intervening call",
      timeoutToggle.replace("    return ()", "    synchronize();\n    return ()"),
    ],
    ["another initializer", timeoutToggle.replace("100);", "100), result = inspect();")],
    ["async effect", timeoutToggle.replace("useLayoutEffect(()", "useLayoutEffect(async ()")],
    ["cleanup initialization", timeoutToggle.replace("return ()", "return (value = inspect())")],
    ["replaced registration", timeoutToggle + "\nwindow.setTimeout = customSchedule;"],
    [
      "replaced cleanup through another alias",
      timeoutToggle + "\nself.clearTimeout = customClear;",
    ],
    ["escaped window", timeoutToggle + "\nregisterHost(window);"],
    ["window property rebinding", timeoutToggle + "\nglobalThis.window = anotherWindow;"],
    ["other realm alias", timeoutToggle + "\nconst alternateWindow = document.defaultView;"],
    ["dynamic document alias", timeoutToggle + "\nconst alternateWindow = document[viewProperty];"],

    ["window prototype override", timeoutToggle + "\nWindow.prototype.clearTimeout = customClear;"],
    ["bare timer replacement", timeoutToggle + "\nclearTimeout = customClear;"],
  ])("keeps the warning for %s", (_description, source) => {
    const result = runRule(noBooleanToggleWithoutFunctionalUpdate, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "body statement",
      timeoutToggle.replace(
        "() => setVisible(!visible)",
        "() => { setVisible(!visible); setVisible(!visible); }",
      ),
    ],
    [
      "default parameter",
      timeoutToggle.replace(
        "() => setVisible(!visible)",
        "(value = setVisible(!visible)) => setVisible(!visible)",
      ),
    ],
  ])("retains consecutive stale toggles in a timeout %s", (_description, source) => {
    const result = runRule(noBooleanToggleWithoutFunctionalUpdate, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
