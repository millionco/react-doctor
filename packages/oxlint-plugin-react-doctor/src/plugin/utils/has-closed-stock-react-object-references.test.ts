import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasClosedStockReactObjectReferences } from "./has-closed-stock-react-object-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

const supportsProvider = (sourceText: string, hasJsonImport = false): boolean => {
  const program = parseSourceText({ filename: "example.tsx", sourceText });
  if (!isNodeOfType(program, "Program")) throw new Error("Expected parseable test source");
  return hasClosedStockReactObjectReferences(program, analyzeScopes(program), () => hasJsonImport);
};

describe("hasClosedStockReactObjectReferences", () => {
  it("allows direct React calls, JSX tags, and erased type references", () => {
    expect(
      supportsProvider(`
      import React, { Children } from "react";
      interface Props extends React.HTMLAttributes<HTMLElement> {}
      export const Panel = (props: Props) => {
        React.useEffect(() => {}, []);
        return <React.Fragment>{Children.toArray(props.children)}</React.Fragment>;
      };
    `),
    ).toBe(true);
  });

  it.each([
    "const runtimeAlias = runtime;",
    "Object.assign(runtime, { jsx: otherFactory });",
    "runtime.jsx = otherFactory;",
    "export { runtime };",
    'const loaded = import("react/jsx-runtime");',
  ])("declines when code can change how JSX is created: %s", (body) => {
    expect(supportsProvider(`import runtime from "react/jsx-runtime"; ${body}`, true)).toBe(false);
  });

  it("allows a dynamic import when the separate emitter proof selects data modules", () => {
    const source = "const data = import(`./locale/${language}.json`);";
    expect(supportsProvider(source)).toBe(false);
    expect(supportsProvider(source, true)).toBe(true);
  });
});
