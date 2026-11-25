import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInRender } from "./no-prop-callback-in-render.js";

const renderGrid = (
  factory: string,
  declaration = "const { run } = factory({ callback: onPrepare });",
  invocation = "run();",
) => `${factory}
  export function Grid({ onPrepare }) {
    ${declaration}
    ${invocation}
    return <section />;
  }
`;

describe.each(["curated", "upstream"])("local callback records in %s mode", (mode) => {
  const run = (source: string) => {
    const result = runRule(noPropCallbackInRender, source, {
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: mode } },
    });
    expect(result.parseErrors).toHaveLength(0);
    return result.diagnostics;
  };

  it.each([
    ["a fresh callback", renderGrid("const factory = (_input) => ({ run: () => 0 });")],
    [
      "a renamed own field",
      renderGrid(
        "const factory = function (_input) { return { own: function () {} }; };",
        "const { own: run } = factory({ callback: onPrepare });",
      ),
    ],
    [
      "an optional invocation",
      renderGrid("const factory = (_input) => ({ run: () => undefined });", undefined, "run?.();"),
    ],
  ])("ignores %s", (_label, source) => {
    expect(run(source)).toHaveLength(0);
  });

  it("reports only the borrowed field of a mixed record", () => {
    const source = renderGrid(
      "const factory = (callback) => ({ run: () => 0, borrowed: callback });",
      "const { run, borrowed } = factory(onPrepare);",
      "run();\n    borrowed();",
    );
    expect(run(source)).toMatchObject([{ line: 5, nodeType: "CallExpression" }]);
  });

  it.each([
    ["a factory argument", "const { run } = factory(onPrepare());", "run();"],
    [
      "an object passed to the factory",
      "const { run } = factory({ callback: onPrepare() });",
      "run();",
    ],
    ["an invocation argument", "const { run } = factory(onPrepare);", "run(onPrepare());"],
  ])("preserves a report when a prop callback runs in %s", (_label, declaration, invocation) => {
    const source = renderGrid(
      "const factory = (_input) => ({ run: () => 0 });",
      declaration,
      invocation,
    );
    expect(run(source)).toHaveLength(1);
  });

  it.each([
    ["returned callback", "const factory = (input) => ({ run: input.callback });"],
    [
      "callback invoked by a wrapper",
      "const factory = (input) => ({ run: () => input.callback() });",
    ],
    ["getter", "const factory = (input) => ({ get run() { return input.callback; } });"],
    [
      "overwriting spread",
      "const factory = (input) => ({ run: () => 0, ...{ run: input.callback } });",
    ],
    [
      "executed sibling initializer",
      "const factory = (input) => ({ run: () => 0, status: input.callback() });",
    ],
    ["opaque factory", 'import { factory } from "external-grid";'],
  ])("preserves reporting for a %s", (_label, factory) => {
    expect(run(renderGrid(factory))).toHaveLength(1);
  });
});
