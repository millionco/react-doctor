import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasClosedJsonSnapshotTransformBindings } from "./has-closed-json-snapshot-transform-bindings.js";
import { parseSourceText } from "./parse-source-file.js";

const inspectTransform = (
  sourceText: string,
  requiredNativeNames: ReadonlyArray<string> = [],
): boolean => {
  const program = parseSourceText({ filename: "view.jsx", sourceText });
  expect(program).not.toBeNull();
  if (!program) throw new Error("Fixture must parse");
  return hasClosedJsonSnapshotTransformBindings(
    {
      filePath: "view.jsx",
      sourceText,
      program,
      scopes: analyzeScopes(program),
    },
    requiredNativeNames,
  );
};

describe("hasClosedJsonSnapshotTransformBindings", () => {
  it.each([
    `import React from "react"; const View = () => <p>Text</p>;`,
    `import * as React from "react"; const View = () => <><p>Text</p></>;`,
    `import React from "react"; const View = () => <p {...props}>Text</p>;`,
    `const plain = "no JSX or implicit helpers";`,
    `if (false) { const View = () => <p>Unreachable</p>; }`,
    `if (false) { const Object = custom; } import React from "react"; const View = () => <p/>;`,
  ])("proves explicit classic binding identity: %s", (source) => {
    expect(inspectTransform(source)).toBe(true);
  });

  it.each([
    `if (module.hot) { const View = () => <p>Development only</p>; }`,
    `if (module.hot) { const Object = custom; } import React from "react"; const View = () => <p/>;`,
    `const View = () => <p>Text</p>;`,
    `const View = () => <>Text</>;`,
    `import Alias from "react"; const View = () => <p/>;`,
    `import { Component as React } from "react"; const View = () => <p/>;`,
    `import React from "alternate-react"; const View = () => <p/>;`,
    `const React = fakeFactory; const View = () => <p/>;`,
    `import React from "react"; const View = (React) => <p/>;`,
    `import React from "react"; function View() { const React = factory; return <p/>; }`,
    `import React from "react"; React = factory; const View = () => <p/>;`,
    `import React from "react"; if (module.hot) { var Object = custom; } const View = () => <p {...props}/>;`,
  ])("declines absent or shadowed implicit identities: %s", (source) => {
    expect(inspectTransform(source)).toBe(false);
  });

  it.each([
    "Object",
    "Array",
    "Symbol",
    "Function",
    "Reflect",
    "Promise",
    "JSON",
    "XMLHttpRequest",
  ])("declines an active %s binding", (name) => {
    expect(
      inspectTransform(
        `import React from "react"; const ${name} = custom; const View = () => <p {...props}/>;`,
      ),
    ).toBe(false);
    expect(
      inspectTransform(`import React from "react"; const View = (${name}) => <p {...props}/>;`),
    ).toBe(false);
  });
  it.each(["Function", "Reflect"])("enforces compiler-required native %s identity", (name) => {
    expect(inspectTransform(`import React from "react"; const View = () => <p/>;`, [name])).toBe(
      true,
    );
    expect(
      inspectTransform(
        `import React from "react"; const ${name} = custom; const View = () => <p/>;`,
        [name],
      ),
    ).toBe(false);
    expect(
      inspectTransform(
        `import React from "react"; if (module.hot) { var ${name} = custom; } const View = () => <p/>;`,
        [name],
      ),
    ).toBe(false);
  });
});
