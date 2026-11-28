import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const fixedTextSlots = `
import { Line } from "./display-ui";
import { createRoot } from "react-dom/client";

const days = [
  { heading: "Monday", tasks: ["Water the plants", "Set up the desk"] },
  { heading: "Tuesday", tasks: ["Wash the towels"] },
];

function Schedule({ offset = 0 }) {
  return <div>
    {days.map(({ heading, tasks }, outerIndex) => (
      <article key={outerIndex}>
        <h2>{heading}</h2>
        <section>
          {tasks.map((task, index) => <Line key={index}>{task}</Line>)}
        </section>
      </article>
    ))}
  </div>;
}

const root = createRoot(document.getElementById("main"));
function Planner() { return <main><Schedule /></main>; }
root.render(<Planner />);
`;

const forwardedTextSlots =
  fixedTextSlots
    .replace("<section>", "<Bridge>")
    .replace("</section>", "</Bridge>")
    .replace("<article key={outerIndex}>", "<Card key={outerIndex}>")
    .replace("</article>", "</Card>") +
  `
const Bridge = ({ children }) => <section className="list">{children}</section>;
function Card({ children: rows }) { return <article>{rows}</article>; }
`;

const rowSelector = `
function Pick({ children, active }) {
  return <div>{children.at(active).props.children.at(1).props.children}</div>;
}
`;

const analyze = (source: string, mode: "curated" | "upstream") => {
  const result = runRule(noArrayIndexAsKey, source, {
    includeLocations: true,
    settings: { "react-doctor": { portedRuleMode: mode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe.each(["curated", "upstream"] as const)("fixed nested text keys in %s mode", (mode) => {
  it("accepts the immutable inner text slots", () => {
    const diagnostics = analyze(fixedTextSlots, mode);
    const inner = fixedTextSlots.split("\n").findIndex((line) => line.includes("key={index}")) + 1;
    expect(diagnostics.some(({ line }) => line === inner)).toBe(false);
  });

  it("accepts private wrappers that forward the same child slot directly", () => {
    const inner =
      forwardedTextSlots.split("\n").findIndex((line) => line.includes("key={index}")) + 1;
    expect(analyze(forwardedTextSlots, mode).some(({ line }) => line === inner)).toBe(false);
  });

  it.each([
    [
      "a local wrapper that indexes into children",
      forwardedTextSlots.replace("{children}</section>", "{children.at(0)}</section>"),
    ],
    [
      "a local wrapper that publishes children",
      forwardedTextSlots.replace("{children}</section>", "{publish(children)}</section>"),
    ],
    [
      "a local wrapper that duplicates the slot",
      forwardedTextSlots.replace("{children}</section>", "{children}{children}</section>"),
    ],
    ["an exported wrapper", forwardedTextSlots.replace("const Bridge =", "export const Bridge =")],
    [
      "a wrapper with dynamic host output",
      forwardedTextSlots
        .replace("<section className", "<ActiveHost className")
        .replace("</section>", "</ActiveHost>"),
    ],
    [
      "a wrapper with a directly captured component value",
      forwardedTextSlots + "\nconsume(Bridge);",
    ],
    [
      "an ancestor that replaces the keyed outer row",
      fixedTextSlots
        .replace("return <div>", "return <Pick active={offset}>")
        .replace("</div>", "</Pick>") + rowSelector,
    ],
    [
      "a custom ancestor around an otherwise intrinsic tree",
      fixedTextSlots
        .replace("return <div>", "return <Pick active={offset}><div>")
        .replace("</div>", "</div></Pick>") +
        rowSelector.replace("children.at(active)", "children.props.children.at(active)"),
    ],
    [
      "a custom component within the outer group",
      fixedTextSlots.replace("<section>", "<Bridge>").replace("</section>", "</Bridge>"),
    ],
    [
      "a component called directly for its elements",
      fixedTextSlots + "\nconst content = Schedule({});",
    ],
    [
      "a component whose JSX may escape through its export",
      fixedTextSlots.replace("function Schedule", "export function Schedule"),
    ],
    [
      "a schedule element captured outside the render path",
      forwardedTextSlots + "\nconst specimen = <Schedule />; consume(specimen.type);",
    ],
    [
      "a schedule passed through a row selector",
      forwardedTextSlots.replace(
        "<main><Schedule /></main>",
        "<Pick active={0}><Schedule /></Pick>",
      ) +
        rowSelector.replace(
          "children.at(active)",
          "children.type(children.props).props.children.at(active)",
        ),
    ],
    [
      "an exported ancestor whose return can expose the schedule",
      forwardedTextSlots.replace("function Planner", "export function Planner"),
    ],
    ["a root receiver that escapes", forwardedTextSlots + "\nconsume(root);"],
    [
      "an opaque renderer that pretends to be React DOM",
      forwardedTextSlots.replace('"react-dom/client"', '"other-client"'),
    ],
    [
      "an exported React root receiver",
      forwardedTextSlots.replace("const root = createRoot", "export const root = createRoot"),
    ],
    ["an escaping table", fixedTextSlots + "\nconsume(days);"],
    ["an exported table", fixedTextSlots + "\nexport { days };"],
    [
      "a nested array that escapes separately",
      fixedTextSlots.replace("{heading}", "{observe(tasks, heading)}"),
    ],
    ["a runtime row property", fixedTextSlots.replace('"Wash the towels"', "getNextTask()")],
    [
      "a dynamic outer key",
      fixedTextSlots.replace("key={outerIndex}", "key={outerIndex + offset}"),
    ],
    [
      "an outer key that can be overridden",
      fixedTextSlots.replace("key={outerIndex}", "key={outerIndex} {...props}"),
    ],
    [
      "a written outer position",
      fixedTextSlots.replace("{heading}", "{describe(outerIndex++, heading)}"),
    ],
    [
      "conditional inner ownership",
      fixedTextSlots.replace("{tasks.map", "{offset ? null : tasks.map"),
    ],
    [
      "event handlers on the row",
      fixedTextSlots.replace("<Line key={index}", "<Line key={index} onClick={() => select(task)}"),
    ],
    [
      "a different rendered child",
      fixedTextSlots.replace("{task}</Line>", "{renderTask(task)}</Line>"),
    ],
    ["a locally replaced map", "Array.prototype.map = customMap;\n" + fixedTextSlots],
    [
      "a module reference through direct eval",
      fixedTextSlots + '\nconst length = eval("days.length");',
    ],
  ])("retains the inner finding for %s", (_name, source) => {
    const inner = source.split("\n").findIndex((line) => line.includes("key={index}")) + 1;
    expect(analyze(source, mode).some(({ line }) => line === inner)).toBe(true);
  });
});
