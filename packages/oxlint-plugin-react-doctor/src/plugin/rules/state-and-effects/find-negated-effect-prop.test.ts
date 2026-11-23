import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { readNamedNegatedMountEffect } from "./find-negated-effect-prop.js";
import { inspectConsumer } from "./inspect-direct-jsx-prop-consumer.js";

const direct = `
import { useEffect } from "react";
export function Panel({ visible, ready, release }) {
  useEffect(() => {
    if (!visible && ready) release();
  }, [visible, ready, release]);
  return null;
}
export default Panel;
`;

const inspect = (sourceText: string) => {
  const program = parseSourceText({ filename: "Panel.tsx", sourceText });
  if (!program || !isNodeOfType(program, "Program")) throw new Error("Invalid synthetic source");
  const scopes = analyzeScopes(program);
  let effect: EsTreeNodeOfType<"CallExpression"> | undefined;
  let component: EsTreeNodeOfType<"FunctionDeclaration"> | undefined;
  walkAst(program, (node) => {
    if (isNodeOfType(node, "FunctionDeclaration") && node.id?.name === "Panel") component = node;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "useEffect"
    )
      effect = node;
  });
  if (!effect || !component) throw new Error("Missing synthetic owner or effect");
  return { result: readNamedNegatedMountEffect(effect, program, scopes), effect, component };
};

const replace = (before: string, after: string) => {
  expect(direct).toContain(before);
  return direct.replace(before, after);
};

describe("named negated mount effect", () => {
  it("finds the same prop and owner across named and default exports", () => {
    const { result, effect, component } = inspect(direct);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Panel");
    expect(result?.property).toBe("visible");
    expect(result?.effect).toBe(effect);
    expect(result?.component).toBe(component);
  });

  it.each([
    [
      "work beside the guarded arm",
      () =>
        replace(
          "    if (!visible && ready) release();",
          "    release();\n    if (!visible && ready) release();",
        ),
    ],
    [
      "an else arm",
      () =>
        replace(
          "if (!visible && ready) release();",
          "if (!visible && ready) release(); else release();",
        ),
    ],
    ["negation on a working RHS", () => replace("!visible && ready", "release() && !visible")],
    [
      "a local variable instead of a prop",
      () =>
        replace("  useEffect(() => {", "  const hidden = ready;\n  useEffect(() => {").replace(
          "!visible && ready",
          "!hidden && ready",
        ),
    ],
    [
      "a foreign effect provider",
      () =>
        replace('import { useEffect } from "react";', 'import { useEffect } from "preact/hooks";'),
    ],
  ])("rejects %s", (_name, makeSource) => {
    expect(inspect(makeSource()).result).toBeNull();
  });

  it("declines a component with an alternate mount in its own file", () => {
    const source = direct.replace(
      "export default Panel;",
      "export function Alternate() { return <Panel visible={false} />; } export default Panel;",
    );
    expect(inspect(source).result).toBeNull();
  });

  it("declines a recursively mounted component", () => {
    const source = direct.replace("  return null;", "  return <Panel visible={false} />;");
    expect(inspect(source).result).toBeNull();
  });
});

describe("closed browser mount owner", () => {
  const common = `
    import { lazy } from "react";
    const Entry = lazy(() => import("./Entry"));
  `;
  const scope = {
    route: "lazy" as const,
    tag: "default",
    property: "visible",
    specifier: "./Entry",
    requireClosedDefaultFunction: true,
  };

  it("recognizes a lazy child of the exported browser component", () => {
    expect(
      inspectConsumer(
        common +
          `
      function View() { return <Entry visible />; }
      export default View;
    `,
        scope,
      ),
    ).toBe(1);
  });

  it("declines a lazy child returned by an ordinary render helper", () => {
    expect(
      inspectConsumer(
        common +
          `
      function renderBody() { return <Entry visible />; }
      export default function View() { return renderBody(); }
    `,
        scope,
      ),
    ).toBeNull();
  });
});
