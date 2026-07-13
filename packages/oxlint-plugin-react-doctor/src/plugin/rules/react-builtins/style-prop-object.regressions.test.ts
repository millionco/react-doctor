import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { stylePropObject } from "./style-prop-object.js";

const expectDiagnosticCount = (code: string, diagnosticCount: number): void => {
  const result = runRule(stylePropObject, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("react-builtins/style-prop-object — JSX runtime ownership regressions", () => {
  it("stays silent on the authentic Solid file-tree string style", () => {
    expectDiagnosticCount(
      `import { Show, createSignal } from "solid-js";
      import { Dynamic } from "solid-js/web";
      export const FileTree = (props) => {
        const [level] = createSignal(props.level);
        return <div
          class="relative"
          classList={{ active: props.active }}
          style={\`left: \${Math.max(0, 8 + level() * 12 - 4) + 8}px\`}
        ><Show when={props.active}><Dynamic component="span" /></Show></div>;
      };`,
      0,
    );
  });

  it("stays silent when solid-js/web establishes file ownership", () => {
    expectDiagnosticCount(
      `import { render } from "solid-js/web";
      render(() => <div style="left: 12px">Solid</div>, document.body);`,
      0,
    );
  });

  it("stays silent when object-valued classList marks a Solid JSX file", () => {
    expectDiagnosticCount(
      `export const SolidPanel = () => (
        <section classList={{ active: true }} style="left: 12px" />
      );`,
      0,
    );
  });

  it("keeps later Solid string styles quiet after an earlier dialect marker", () => {
    expectDiagnosticCount(
      `export const SolidPanel = () => <>
        <div classList={{ active: true }} />
        <div style={\`left: 12px\`} />
      </>;`,
      0,
    );
  });

  it("still reports a React intrinsic string style in a mixed-runtime package", () => {
    expectDiagnosticCount(
      `import { useState } from "react";
      export const ReactPanel = () => {
        const [left] = useState(12);
        return <div style={\`left: \${left}px\`}>React</div>;
      };`,
      1,
    );
  });

  it("still reports string style when the file runtime is ambiguous", () => {
    expectDiagnosticCount(`export const Panel = () => <div style="left: 12px" />;`, 1);
  });

  it("keeps React and Solid object styles quiet", () => {
    expectDiagnosticCount(
      `import { createSignal } from "solid-js";
      const [left] = createSignal(12);
      export const SolidPanel = () => <div style={{ left: \`\${left()}px\` }} />;`,
      0,
    );
    expectDiagnosticCount(
      `import { useState } from "react";
      export const ReactPanel = () => {
        const [left] = useState(12);
        return <div style={{ left }}>React</div>;
      };`,
      0,
    );
  });
});
