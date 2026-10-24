import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { isClosedNativeClassStateSetterCall } from "../../utils/is-closed-native-class-state-setter-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface ClassUpdaterCase {
  name: string;
  code: string;
  expectedDiagnostics: number;
}

const nativeClassCases: ClassUpdaterCase[] = [
  {
    name: "direct native default import",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState(previous => { console.log(previous); return {}; }); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "named import aliases and static setter do not shadow the instance setter",
    code: `import { Component as Base } from "react"; import { render as mount } from "react-dom";
      class Panel extends Base { static setState(update) { update(); } retry = () => this["setState"](previous => { console.log(previous); return {}; }); }
      mount(<Panel />, document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "namespace PureComponent and lexical nested arrows",
    code: `import * as React from "react"; import * as ReactDOM from "react-dom";
      class Panel extends React.PureComponent { retry = () => (() => this.setState(previous => { console.log(previous); return {}; }))(); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "readonly conditional constructor aliases",
    code: `import React from "react"; import ReactDOM from "react-dom"; import { options } from "./options";
      class Panel extends React.Component { retry = () => this.setState(previous => { console.log(previous); return {}; }); render() { return <React.Fragment />; } }
      const Selected = options.component || Panel; const Display = options.other ? Selected : Panel;
      ReactDOM.render(<Display />, document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "transparent TypeScript wrappers",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => ((this as Panel).setState)((previous: unknown) => { console.log(previous); return {}; }); }
      ReactDOM.render((<Panel />), document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "executed local helper effects",
    code: `import React from "react"; import ReactDOM from "react-dom";
      const appendNotice = () => document.body.appendChild(document.createElement("div"));
      class Panel extends React.Component { retry = () => this.setState(() => { appendNotice(); return {}; }); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 1,
  },
  {
    name: "pure first payload and effectful completion callback",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState(previous => ({ count: previous.count + 1 }), () => console.log("committed")); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 0,
  },
  {
    name: "object payload and effectful completion callback",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState({ count: 1 }, () => console.log("committed")); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 0,
  },
  {
    name: "deferred callback returned in state",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState(() => ({ onClick: () => console.log("later") })); }
      ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 0,
  },
  {
    name: "ordinary method with borrowed receiver",
    code: `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry() { this.setState(() => { console.log("custom"); return {}; }); } }
      Panel.prototype.retry.call({ setState(update) { update(); } }); ReactDOM.render(<Panel />, document.body);`,
    expectedDiagnostics: 0,
  },
];

const refusedClassVariants: Record<string, string> = {
  "own setter field": `setState = update => update();`,
  "own setter method": `setState(update) { update(); }`,
  "own setter getter": `get setState() { return update => update(); }`,
  "custom updater": `updater = { enqueueSetState() {} };`,
  "explicit constructor": `constructor(props) { super(props); }`,
  "unknown computed key": `[methodName] = value => value;`,
  "instance escape": `expose = () => consume(this);`,
  "instance alias": `expose = () => { const instance = this; consume(instance); };`,
  "setter extraction": `extract = () => consume(this.setState);`,
  "setter replacement": `replace = () => { this.setState = update => update(); };`,
  "updater extraction": `extract = () => consume(this.updater);`,
  "constructor capability": `replace = () => { this.constructor.prototype.setState = update => update(); };`,
  "prototype capability": `replace = () => consume(this.__proto__);`,
  "instance getter replacement": `replace = () => this.__defineGetter__("setState", () => consume);`,
  "instance valueOf escape": `replace = () => { const instance = this.valueOf(); instance.setState = consume; };`,
  "dynamic instance access": `replace = () => consume(this[methodName]);`,
  "nested constructor capability": `replace = () => consume(this.props.constructor.constructor);`,
  "super setter replacement": `replace = () => { super.setState = update => update(); };`,
  "nested class capability": `factory = () => class Child extends React.Component {};`,
};

const refusedTransports: Record<string, string> = {
  "class prototype mutation": `Panel.prototype.setState = update => update(); ReactDOM.render(<Panel />, document.body);`,
  "constructor alias prototype mutation": `const Alias = Panel; Alias.prototype.setState = update => update(); ReactDOM.render(<Panel />, document.body);`,
  "subclass override": `class Child extends Panel { setState(update) { update(); } } ReactDOM.render(<Child />, document.body);`,
  "constructor escape": `consume(Panel); ReactDOM.render(<Panel />, document.body);`,
  "element escape": `const element = <Panel />; consume(element); ReactDOM.render(element, document.body);`,
  "custom parent": `ReactDOM.render(<Wrapper><Panel /></Wrapper>, document.body);`,
  "instance ref": `ReactDOM.render(<Panel ref={instance => { instance.setState = update => update(); }} />, document.body);`,
  "spread props": `ReactDOM.render(<Panel {...props} />, document.body);`,
  "render result instance": `const instance = ReactDOM.render(<Panel />, document.body); instance.setState = update => update();`,
  "render completion receiver": `ReactDOM.render(<Panel />, document.body, function () { this.setState = update => update(); });`,
  "provider replacement": `ReactDOM.render = consume; ReactDOM.render(<Panel />, document.body);`,
  "JSX provider replacement": `React.createElement = consume; ReactDOM.render(<Panel />, document.body);`,
  "base getter replacement": `React.__defineGetter__("Component", () => Custom); ReactDOM.render(<Panel />, document.body);`,
  "provider valueOf escape": `consume(React.valueOf()); ReactDOM.render(<Panel />, document.body);`,
  "second superclass import mutation": `import { Component as Other } from "react"; Other.prototype.setState = consume; ReactDOM.render(<Panel />, document.body);`,
  "second ReactDOM import mutation": `import OtherDOM from "react-dom"; OtherDOM.render = consume; ReactDOM.render(<Panel />, document.body);`,
  "CommonJS provider replacement": `const other = require("react"); other.Component.prototype.setState = consume; ReactDOM.render(<Panel />, document.body);`,
  "dynamic provider replacement": `import("react").then(other => { other.Component.prototype.setState = consume; }); ReactDOM.render(<Panel />, document.body);`,
  "createRequire provider replacement": `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const other = load("react"); other.Component.prototype.setState = consume; ReactDOM.render(<Panel />, document.body);`,
  "base prototype replacement": `React.Component.prototype.setState = update => update(); ReactDOM.render(<Panel />, document.body);`,
  "exported constructor": `export { Panel }; ReactDOM.render(<Panel />, document.body);`,
  "dynamic scope": `eval("Panel.prototype.setState = consume"); ReactDOM.render(<Panel />, document.body);`,
};

describe("native class state updater purity", () => {
  it("rechecks changed JSX configuration with the same class scope", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-class-updater-config-"));
    const filename = path.join(directory, "panel.tsx");
    const configPath = path.join(directory, "tsconfig.json");
    const code = `import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState(() => { console.log("retry"); return {}; }); }
      ReactDOM.render(<Panel />, document.body);`;
    fs.writeFileSync(filename, code);
    const eligibility: boolean[] = [];
    try {
      const result = runRule(
        {
          ...noSideEffectInStateUpdaterFunction,
          create: (context) => ({
            CallExpression: (node) => {
              if (
                !isNodeOfType(node, "CallExpression") ||
                !isNodeOfType(node.callee, "MemberExpression") ||
                !isNodeOfType(node.callee.object, "ThisExpression")
              )
                return;
              eligibility.push(isClosedNativeClassStateSetterCall(node, context));
              fs.writeFileSync(
                configPath,
                JSON.stringify({ compilerOptions: { jsxFactory: "customFactory" } }),
              );
              resetTsconfigAliasCaches();
              eligibility.push(isClosedNativeClassStateSetterCall(node, context));
              fs.unlinkSync(configPath);
              resetTsconfigAliasCaches();
              eligibility.push(isClosedNativeClassStateSetterCall(node, context));
            },
          }),
        },
        code,
        { filename },
      );
      expect(result.parseErrors).toEqual([]);
      expect(eligibility).toEqual([true, false, true]);
    } finally {
      resetTsconfigAliasCaches();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  for (const testCase of nativeClassCases) {
    it(testCase.name, () => {
      const result = runRule(noSideEffectInStateUpdaterFunction, testCase.code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedDiagnostics);
    });
  }

  for (const [name, member] of Object.entries(refusedClassVariants)) {
    it(`keeps ${name} quiet`, () => {
      const result = runRule(
        noSideEffectInStateUpdaterFunction,
        `
        import React from "react"; import ReactDOM from "react-dom";
        class Panel extends React.Component { ${member} retry = () => this.setState(() => { console.log("custom"); return {}; }); }
        ReactDOM.render(<Panel />, document.body);
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }

  for (const [name, transport] of Object.entries(refusedTransports)) {
    it(`keeps ${name} quiet`, () => {
      const result = runRule(
        noSideEffectInStateUpdaterFunction,
        `
        import React from "react"; import ReactDOM from "react-dom";
        class Panel extends React.Component { retry = () => this.setState(() => { console.log("custom"); return {}; }); }
        ${transport}
      `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }

  it("does not adopt unrelated normal-function this", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => { function invoke() { this.setState(() => { console.log("custom"); return {}; }); } invoke.call(custom); }; }
      ReactDOM.render(<Panel />, document.body);
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not adopt custom inheritance", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import React from "react"; import ReactDOM from "react-dom";
      class Base extends React.Component { setState(update) { update(); } }
      class Panel extends Base { retry = () => this.setState(() => { console.log("custom"); return {}; }); }
      ReactDOM.render(<Panel />, document.body);
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects erased superclass imports", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import type { Component } from "react"; import ReactDOM from "react-dom";
      class Panel extends Component { retry = () => this.setState(() => { console.log("custom"); return {}; }); }
      ReactDOM.render(<Panel />, document.body);
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects custom JSX pragmas", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      /** @jsx customFactory */
      import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { retry = () => this.setState(() => { console.log("custom"); return {}; }); }
      ReactDOM.render(<Panel />, document.body);
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not adopt a static arrow receiver", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `
      import React from "react"; import ReactDOM from "react-dom";
      class Panel extends React.Component { static retry = () => this.setState(() => { console.log("custom"); return {}; }); }
      ReactDOM.render(<Panel />, document.body);
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
