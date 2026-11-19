import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noDerivedState } from "./no-derived-state.js";

const rule = wrapWithSemanticContext(noDerivedState) as Rule;
const defaultCallback =
  "choose={() => setSelected(selected === choice.value ? null : choice.value)}";
const row = "<ChoiceRow {...choice} " + defaultCallback + " />";
const defaultMap = "{choices.map((choice) => " + row + ")}";
const defaultHost = '<button type="button" onClick={choose}>{value}</button>';

const fixture = (parent = "<div>" + defaultMap + "</div>", host = defaultHost, extra = "") =>
  `
  import { useEffect, useState } from "react";
  export function ChoiceList({
    initialSelected, choices
  }: {
    initialSelected: string | null;
    choices: { value: string }[];
  }) {
    const [selected, setSelected] = useState(initialSelected);
    useEffect(() => {
      setSelected(initialSelected);
    }, [initialSelected]);
    return ${parent};
  }
  function ChoiceRow({ value, choose }: { value: string; choose: () => void }) {
    return ${host};
  }
  ${extra}
`;

describe("no-derived-state local button callback", () => {
  it("recognizes a choice made through a local child's native click handler", () => {
    const result = runRule(rule, fixture(), { filename: "choices.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["callback omitted by the child", fixture(undefined, "<button>{value}</button>")],
    [
      "disabled native control",
      fixture(undefined, "<button disabled onClick={choose}>{value}</button>"),
    ],
    [
      "unknown native event override",
      fixture(
        undefined,
        "<button onClick={choose} {...forwardsButtonProps(value)}>{value}</button>",
      ),
    ],
    [
      "unknown parent callback override",
      fixture(
        "<div>{choices.map((choice) => <ChoiceRow " +
          defaultCallback +
          " {...getRowProps(choice)} value={choice.value} />)}</div>",
      ),
    ],
    [
      "a callback that copies the same prop into state",
      fixture(
        "<div>" +
          defaultMap.replace(defaultCallback, "choose={() => setSelected(initialSelected)}") +
          "</div>",
      ),
    ],
    [
      "a callback that writes the existing state back",
      fixture(
        "<div>" +
          defaultMap.replace(defaultCallback, "choose={() => setSelected(selected)}") +
          "</div>",
      ),
    ],
    [
      "a known native map replacement that renders no children",
      fixture(undefined, undefined, "Array.prototype.map = function () { return []; };"),
    ],
    [
      "a child that returns null before the button",
      fixture(
        "<div>" + defaultMap.replace(row, row.replace("{...choice}", 'value=""')) + "</div>",
      ).replace("return " + defaultHost, "if (!value) return null; return " + defaultHost),
    ],
    ["inert ancestor", fixture("<div inert>" + defaultMap + "</div>")],
    [
      "capture handler preventing the click",
      fixture("<div onClickCapture={(event) => event.stopPropagation()}>" + defaultMap + "</div>"),
    ],
    [
      "children discarded by their wrapper",
      fixture(
        "<Discard>" + defaultMap + "</Discard>",
        undefined,
        "function Discard() { return null; }",
      ),
    ],
  ])("retains the warning for %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "choices.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
