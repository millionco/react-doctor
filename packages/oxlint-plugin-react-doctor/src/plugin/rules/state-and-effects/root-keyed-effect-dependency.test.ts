import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const source = (render: string, dependency = "revision") => `
import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
function DraftPane({ revision, locked }) {
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setText("");
    setDirty(false);
  }, [${dependency}]);
  return <button disabled={locked} onClick={() => { setText("draft"); setDirty(true); }}>
    {dirty ? text : "Ready"}
  </button>;
}
${render}
`;

const render = `
const root = createRoot(document.getElementById("root"));
function showRevision(rawId) {
  const revision = String(rawId);
  root.render(createElement(DraftPane, { key: revision, revision }));
}
showRevision(1);
showRevision(2);
`;

const directRender = `
function showRevision(rawId) {
  const version = \`rev-\${rawId}\`;
  createRoot(document.getElementById("root")).render(
    createElement(DraftPane, { key: version, revision: version })
  );
}
`;

describe("state resets keyed by the dependency string", () => {
  it("keeps the diagnostics when a second effect writes state on mount", () => {
    const fixture = source(render)
      .replace("useEffect, useState", "useEffect, useLayoutEffect, useState")
      .replace(
        "  useEffect(() =>",
        '  useLayoutEffect(() => { setText("layout"); setDirty(true); }, []);\n  useEffect(() =>',
      );
    expect(runRule(noAdjustStateOnPropChange, fixture).diagnostics).toHaveLength(2);
    expect(runRule(noResetAllStateOnPropChange, fixture).diagnostics).toHaveLength(1);
  });

  it("keeps mount-time writes to a different value visible", () => {
    const fixture = source(render).replace('setText("");', 'setText("Loaded");');
    const adjustment = runRule(noAdjustStateOnPropChange, fixture);
    expect(adjustment.parseErrors).toEqual([]);
    expect(adjustment.diagnostics).toHaveLength(2);
  });

  it.each([render, directRender])("leaves the reset to the root render key", (callers) => {
    const results = [noAdjustStateOnPropChange, noResetAllStateOnPropChange].map((rule) =>
      runRule(rule, source(callers)),
    );
    for (const result of results) {
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    ["different values", render.replace("key: revision", 'key: "fixed"'), "revision"],
    ["an unnormalized key", render.replace("String(rawId)", "rawId"), "revision"],
    ["a shadowed normalizer", `const String = (value) => value; ${render}`, "revision"],
    ["a later prop override", render.replace("revision }", "revision, ...other }"), "revision"],
    [
      "an escaping element",
      render.replace(
        "root.render(createElement(DraftPane, { key: revision, revision }));",
        "root.render(passThrough(createElement(DraftPane, { key: revision, revision })));",
      ),
      "revision",
    ],
    ["an exposed root", `export { root }; ${render}`, "revision"],
    ["an exposed component", `export { DraftPane }; ${render}`, "revision"],
    [
      "a second unkeyed caller",
      `${render}\nroot.render(createElement(DraftPane, { revision: "v2" }));`,
      "revision",
    ],
    ["a local renderer lookalike", render.replace("createRoot(", "makeRoot("), "revision"],
    ["independent dependencies", render, "revision, locked"],
    [
      "an accessor in the props object",
      render.replace("revision }", "get other() { this.revision = rawId; }, revision }"),
      "revision",
    ],
    [
      "a prototype initializer in the props object",
      render.replace("revision }", "revision, __proto__: prototype }"),
      "revision",
    ],
    [
      "an element with positional children",
      render.replace("revision }", "revision }, rawId"),
      "revision",
    ],
    [
      "a component call without props",
      render.replace("{ key: revision, revision }", "").replace("DraftPane, )", "DraftPane)"),
      "revision",
    ],
    [
      "a root whose renderer can be overwritten",
      render + "\nroot.render = otherRender;",
      "revision",
    ],
    [
      "a direct eval with access to the component",
      render + '\neval("observe(DraftPane)");',
      "revision",
    ],
  ])("keeps both rules active for %s", (_description, callers, dependency) => {
    const adjustment = runRule(noAdjustStateOnPropChange, source(callers, dependency));
    const reset = runRule(noResetAllStateOnPropChange, source(callers, dependency));
    expect(adjustment.parseErrors).toEqual([]);
    expect(reset.parseErrors).toEqual([]);
    expect(adjustment.diagnostics).toHaveLength(2);
    expect(reset.diagnostics).toHaveLength(1);
  });
});
