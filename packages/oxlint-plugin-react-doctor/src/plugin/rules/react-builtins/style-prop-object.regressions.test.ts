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

  it("does not infer Solid ownership from a string classList prop", () => {
    expectDiagnosticCount(
      `export const Panel = () => <div classList="active" style="left: 12px" />;`,
      1,
    );
  });

  it("does not infer Solid ownership from an unresolved classList expression", () => {
    expectDiagnosticCount(
      `export const Panel = ({ classes }) => (
        <div classList={classes} style="left: 12px" />
      );`,
      1,
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

  it("keeps earlier Solid string styles quiet before a later dialect marker", () => {
    expectDiagnosticCount(
      `export const SolidPanel = () => <>
        <div style={\`left: 12px\`} />
        <div classList={{ active: true }} />
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

  it("still reports when React and Solid runtime imports coexist", () => {
    expectDiagnosticCount(
      `import { useState } from "react";
      import { createSignal } from "solid-js";
      export const ReactPanel = () => {
        const [left] = useState(12);
        createSignal(left);
        return <div style={\`left: \${left}px\`}>React</div>;
      };`,
      1,
    );
  });

  it("still reports after a late Solid syntax marker in a React-owned file", () => {
    expectDiagnosticCount(
      `import { Fragment } from "react";
      export const ReactPanel = () => <Fragment>
        <div classList={{ active: true }} />
        <div style="left: 12px" />
      </Fragment>;`,
      1,
    );
  });

  it("does not infer Solid ownership from a type-only import", () => {
    expectDiagnosticCount(
      `import type { JSX } from "solid-js";
      export const Panel = (): JSX.Element => <div style="left: 12px" />;`,
      1,
    );
  });

  it("does not infer Solid ownership from inline type-only imports", () => {
    expectDiagnosticCount(
      `import { type JSX } from "solid-js";
      export const Panel = (): JSX.Element => <div style="left: 12px" />;`,
      1,
    );
  });

  it("accepts a Solid runtime import alongside a React type-only import", () => {
    expectDiagnosticCount(
      `import type { ReactNode } from "react";
      import { createSignal as makeSignal } from "solid-js";
      const [left] = makeSignal(12);
      export const SolidPanel = (): ReactNode => <div style={\`left: \${left()}px\`} />;`,
      0,
    );
  });

  it("accepts explicit Solid JSX runtime ownership", () => {
    expectDiagnosticCount(
      `import { jsx } from "solid-js/jsx-runtime";
      export const SolidPanel = () => <div style="left: 12px">{jsx}</div>;`,
      0,
    );
  });

  it("accepts a bare Solid runtime import", () => {
    expectDiagnosticCount(
      `import "solid-js";
      export const SolidPanel = () => <div style="left: 12px" />;`,
      0,
    );
  });

  it("does not treat similarly named userland packages as Solid", () => {
    expectDiagnosticCount(
      `import { createSignal } from "solid-js-userland";
      export const Panel = () => <div style="left: 12px">{createSignal}</div>;`,
      1,
    );
  });

  it("preserves React createElement diagnostics in mixed-runtime files", () => {
    expectDiagnosticCount(
      `import React from "react";
      import { createSignal } from "solid-js";
      const [left] = createSignal(12);
      export const ReactPanel = () => React.createElement("div", {
        style: \`left: \${left()}px\`,
      });`,
      1,
    );
  });

  it("does not apply React createElement semantics to Solid-owned files", () => {
    expectDiagnosticCount(
      `import { createSignal } from "solid-js";
      const createElement = (tag, props) => ({ tag, props });
      export const solidNode = createElement("div", { style: "left: 12px" });`,
      0,
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
