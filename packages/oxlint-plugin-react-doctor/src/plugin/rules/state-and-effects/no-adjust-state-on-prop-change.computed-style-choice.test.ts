import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const rule = wrapWithSemanticContext(noAdjustStateOnPropChange) as Rule;
const styleChoice = `
  if (style.display === "block") {
    setLayout("stack");
  } else if (style.display === "flex" && style.flexDirection === "row") {
    setLayout("rail");
  } else {
    setLayout("plain");
  }
`;
const propReset = 'if (mode === "plain") setSelected(false);';

const fixture = (
  choice: string,
  { setup = "", mutate = "", inHelper = "", inEffect = "" } = {},
): string => `
  import { useCallback, useEffect, useState } from "react";

  export function useShelfLayout(node: HTMLElement, mode: string) {
    const [layout, setLayout] = useState("plain");
    const [selected, setSelected] = useState(true);
    ${setup}

    const measure = useCallback(() => {
      const style = window.getComputedStyle(node);
      ${mutate}
      ${choice}
      ${inHelper}
    }, [node, mode]);

    useEffect(() => {
      measure();
      ${inEffect}
    }, [measure, mode]);

    return { layout, selected };
  }
`;

const reportedWrites = (code: string): ReadonlyArray<string | undefined> => {
  const result = runRule(rule, code, { filename: "shelf.tsx", includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  const lines = code.split("\n");
  return result.diagnostics.map(({ line }) =>
    line === undefined ? undefined : lines[line - 1]?.trim(),
  );
};

describe("no-adjust-state-on-prop-change computed style choices", () => {
  it("recognizes state selected by the live browser style", () => {
    expect(reportedWrites(fixture(styleChoice))).toEqual([]);
  });

  it.each([
    ["in the same helper", { inHelper: propReset }],
    ["directly in the effect", { inEffect: propReset }],
  ])("reports a separate prop-driven reset %s", (_name, location) => {
    expect(reportedWrites(fixture(styleChoice, location))).toEqual([propReset]);
  });

  it.each([
    [
      "an unused style read",
      styleChoice
        .replaceAll("style.display", "mode")
        .replace('style.flexDirection === "row"', "true"),
      {},
      3,
    ],
    [
      "a condition that also reads a prop",
      styleChoice.replace('style.flexDirection === "row"', 'mode === "row"'),
      {},
      3,
    ],
    [
      "identical values in every arm",
      styleChoice.replaceAll(/setLayout\("[a-z]+"\)/g, 'setLayout("plain")'),
      {},
      3,
    ],
    [
      "the same style selector repeated in the else-if",
      styleChoice.replace('"flex"', '"block"'),
      {},
      3,
    ],
    [
      "a shadowed browser provider",
      styleChoice,
      {
        setup:
          'const window = { getComputedStyle: () => ({ display: mode, flexDirection: "row" }) };',
      },
      3,
    ],
    [
      "a browser method replaced through a realm alias",
      styleChoice,
      { setup: "const realm = window; realm.getComputedStyle = () => ({ display: mode });" },
      3,
    ],
    [
      "a style property changed before the branch",
      styleChoice,
      { mutate: "style.display = mode;" },
      3,
    ],
    [
      "a different state setter in the fallback arm",
      styleChoice.replace('setLayout("plain");', "setSelected(false);"),
      {},
      3,
    ],
  ] as const)("reports the adjustment for %s", (_name, choice, options, count) => {
    expect(reportedWrites(fixture(choice, options))).toHaveLength(count);
  });
});
