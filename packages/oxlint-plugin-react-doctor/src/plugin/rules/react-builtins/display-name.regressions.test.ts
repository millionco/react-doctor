import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

const runJsx = (code: string, settings?: Readonly<Record<string, unknown>>) =>
  runRule(displayName, code, { filename: "fixture.jsx", settings });

describe("react-builtins/display-name — regressions: extended HoC awareness", () => {
  it("flags an anonymous component wrapped in `React.memo`", () => {
    const result = runJsx(`
      module.exports = React.memo(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `React.forwardRef`", () => {
    const result = runJsx(`
      module.exports = React.forwardRef((props, ref) => <div ref={ref} />);
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in MobX `observer` by default", () => {
    const result = runJsx(`
      module.exports = observer(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `lazy(() => ...)` by default", () => {
    const result = runJsx(`
      module.exports = lazy(() => <div />);
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `withTracking` by default", () => {
    const result = runJsx(`
      module.exports = withTracking(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in a project-custom HoC via settings", () => {
    const result = runJsx(
      `
      module.exports = withRedux(function () { return <div /> });
    `,
      {
        "react-doctor": {
          displayName: { additionalHoCs: ["withRedux"] },
        },
      },
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a named function inside `observer`", () => {
    const result = runJsx(`
      module.exports = observer(function MyComponent() { return <div /> });
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a custom HoC name when it isn't in the settings list", () => {
    const result = runJsx(`
      module.exports = withRedux(function () { return <div /> });
    `);
    // \`withRedux\` is not in the DEFAULT additionalHoCs and not memo/forwardRef.
    // No diagnostic.
    expect(result.diagnostics).toEqual([]);
  });

  it("allows users to override the default `observer` recognition by setting additionalHoCs explicitly", () => {
    const result = runJsx(
      `
      module.exports = observer(function () { return <div /> });
    `,
      {
        "react-doctor": {
          displayName: { additionalHoCs: [] },
        },
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});

describe("react-builtins/display-name — regressions: curried factory body shapes", () => {
  it("flags an anonymous arrow component returned from a block-body arrow factory", () => {
    const result = runJsx(`
      export const h = (order) => { return (props) => <Title order={order} {...props} />; };
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the same factory with an expression body identically", () => {
    const blockBody = runJsx(`
      export const h = (order) => { return (props) => <Title order={order} {...props} />; };
    `);
    const expressionBody = runJsx(`
      export const h = (order) => (props) => <Title order={order} {...props} />;
    `);
    expect(blockBody.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expressionBody.diagnostics.map((diagnostic) => diagnostic.message),
    );
  });

  it("does not flag a PascalCase arrow component with a block body", () => {
    const result = runJsx(`
      const Header = (props) => { return <div {...props} />; };
      export default Header;
    `);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("react-builtins/display-name — exported data callbacks", () => {
  it.each([
    {
      name: "typed-inline-csf-meta-decorator",
      code: 'import type { ComponentMeta } from "@storybook/react";\nimport React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { title: "Synthetic/Panel", component: Panel, decorators: [story => <Shell>{story()}</Shell>] } as ComponentMeta<typeof Panel>;\nexport function Example(){ return <Panel/>; }',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "aliased-csf-type-satisfies",
      code: 'import type { ImportedMeta } from "@storybook/react";\nimport React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { title: "Synthetic/Other", component: Panel, decorators: [story => <>{story()}</>] } satisfies ImportedMeta<typeof Panel>;',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "untyped-exported-callback-data",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { label: "metadata", callbacks: [render => <Shell>{render()}</Shell>] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "default-array-callback-data",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default [value => <Shell>{value()}</Shell>];',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "nested-data-property-and-transparent-cast",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default ({ configuration: { decorator: [story => <Shell>{story()}</Shell>] } } as unknown);',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "function-expression-role-consistency",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { decorators: [function(story){ return <Shell>{story()}</Shell>; }] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 0,
    },
    {
      name: "direct-default-anonymous-component",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default () => <Panel/>;',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "direct-default-component-transparent-as",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default (() => <Panel/>) as unknown;',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "direct-default-component-satisfies",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default (() => <Panel/>) satisfies ((props: unknown) => React.ReactNode);',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "default-component-returning-element-array",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default () => [<Panel key="first"/>];',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "memo-inside-exported-data-still-component",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { decorators: [React.memo(() => <Panel/>)] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "forward-ref-inside-exported-data-still-component",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { components: [React.forwardRef((props,ref) => <span ref={ref}/>)] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "immediate-nested-render-factory-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { make: () => () => <Panel/> };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "returned-function-factory-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport const make = () => { return function(){ return <Panel/>; }; };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "configured-hoc-in-data-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { components: [withState(() => <Panel/>)] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
        settings: {
          "react-doctor": {
            displayName: {
              additionalHoCs: ["withState"],
            },
          },
        },
      },
      expectedDiagnostics: 1,
    },
    {
      name: "anonymous-class-in-data-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { View: class extends React.Component { render(){ return <Panel/>; } } };',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "module-exports-anonymous-component-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nmodule.exports = () => <Panel/>;',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "unknown-default-call-path-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default consume(() => <Panel/>);',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
    {
      name: "raw-port-container-behavior-preserved",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default { decorators: [story => <Shell>{story()}</Shell>] };',
      options: {
        filename: "synthetic-panel.stories.tsx",
        settings: {
          "react-doctor": {
            portedRuleMode: "oxc",
          },
        },
      },
      expectedDiagnostics: 1,
    },
    {
      name: "story-filename-direct-default-still-reports",
      code: 'import React from "react"; const Panel = () => <span>Panel</span>; const Shell = ({children}) => <section>{children}</section>;\nexport default () => <Shell><Panel/></Shell>;',
      options: {
        filename: "synthetic-panel.stories.tsx",
      },
      expectedDiagnostics: 1,
    },
  ])("$name", ({ code, options, expectedDiagnostics }) => {
    const result = runRule(displayName, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
