import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNestedComponentDefinition } from "./no-nested-component-definition.js";

const commonOptions = { filename: "src/example.tsx", forceJsx: true, includeLocations: true };

const cases = [
  {
    name: "native-click-void-arrow",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "canonical-button-async-no-render",
    code: 'import React from "react";\nimport { Button } from "antd";\nexport const Parent = () => { const Press = async () => { await Promise.resolve(); }; return <Button onClick={Press}>Press</Button>; };\n',
    count: 0,
  },
  {
    name: "renamed-canonical-button-import",
    code: 'import React from "react";\nimport { Button as ActionButton } from "antd";\nexport const Parent = () => { const Press = () => {}; return <ActionButton onClick={Press}>Press</ActionButton>; };\n',
    count: 0,
  },
  {
    name: "native-click-function-declaration",
    code: 'import React from "react";\nexport const Parent = () => { function Press() {} return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "native-click-bare-early-return",
    code: 'import React from "react";\nexport const Parent = ({ ready }: { ready: boolean }) => { const Press = () => { if (!ready) return; }; return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "multiple-native-click-uses",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; return <div><button onClick={Press}>One</button><button onClick={Press}>Two</button></div>; };\n',
    count: 0,
  },
  {
    name: "own-jsx-return-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { return <span>Value</span>; }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "own-null-return-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { return null; }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "actual-void-component-tag-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; return <Press />; };\n',
    count: 1,
  },
  {
    name: "mixed-click-and-component-tag-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; return <div><button onClick={Press}>Press</button><Press /></div>; };\n',
    count: 1,
  },
  {
    name: "component-valued-route-prop-keeps-legacy",
    code: 'import React from "react";\nimport { Route } from "example-router";\nexport const Parent = () => { const Press = () => <span>Value</span>; return <Route component={Press} />; };\n',
    count: 1,
  },
  {
    name: "unknown-custom-onclick-keeps-legacy",
    code: 'import React from "react";\nimport { CustomButton } from "example-ui";\nexport const Parent = () => { const Press = () => {}; return <CustomButton onClick={Press} />; };\n',
    count: 1,
  },
  {
    name: "local-button-shadow-keeps-legacy",
    code: 'import React from "react";\nconst Button = ({ onClick: Child }) => <Child />;\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press} />; };\n',
    count: 1,
  },
  {
    name: "type-only-button-provider-keeps-legacy",
    code: 'import React from "react";\nimport type { Button } from "antd";\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press} />; };\n',
    count: 1,
  },
  {
    name: "callback-value-alias-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; const forwarded = Press; void forwarded; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "mutable-callback-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { let Press = () => {}; Press = () => {}; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "destructuring-write-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { let Press = () => {}; [Press] = [() => {}]; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "lexical-eval-reference-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; void eval; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "runtime-enum-profile-keeps-legacy",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; enum Marker { First = 0 } void Marker; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "lowercase-event-legacy-quiet",
    code: 'import React from "react";\nexport const Parent = () => { const press = () => {}; return <button onClick={press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "inline-render-helper-legacy-quiet",
    code: 'import React from "react";\nexport const Parent = () => { const RenderItem = () => <span>Item</span>; return <div>{RenderItem()}</div>; };\n',
    count: 0,
  },
  {
    name: "provider-whole-value-alias-keeps-legacy",
    code: 'import React from "react";\nimport { Button } from "antd";\nconst ForwardedButton = Button; void ForwardedButton;\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "nested-function-return-is-not-own-return",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { const readValue = () => 3; void readValue; }; return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "other-native-event-outside-first-profile",
    code: 'import React from "react";\nexport const Parent = () => { const Change = () => {}; return <input onChange={Change} />; };\n',
    count: 1,
  },
  {
    name: "own-native-state-hook-no-return",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { React.useState(0); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "own-discarded-jsx-expression",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { <span>Value</span>; }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "nested-jsx-return-not-own-output",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { const buildItem = () => <span>Value</span>; void buildItem; }; return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "direct-loop-write",
    code: 'import React from "react";\nexport const Parent = () => { let Press = () => {}; for (Press of []) {} return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "destructuring-loop-write",
    code: 'import React from "react";\nexport const Parent = () => { let Press = () => {}; for ([Press] of []) {} return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "object-pattern-write",
    code: 'import React from "react";\nexport const Parent = () => { let Press = () => {}; ({ item: Press } = { item: () => {} }); return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "inline-type-only-provider",
    code: 'import React from "react";\nimport { type Button } from "antd";\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "namespace-provider-outside-profile",
    code: 'import React from "react";\nimport * as Antd from "antd";\nexport const Parent = () => { const Press = () => {}; return <Antd.Button onClick={Press}>Press</Antd.Button>; };\n',
    count: 1,
  },
  {
    name: "default-provider-outside-profile",
    code: 'import React from "react";\nimport Button from "antd";\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "provider-parameter-shadow",
    code: 'import React from "react";\nimport { Button } from "antd";\nexport const Parent = ({ Button }) => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "callback-same-name-distinct-binding",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; const renderItem = () => { const Press = () => <span>Child</span>; return <Press />; }; return <div><button onClick={Press}>Press</button>{renderItem()}</div>; };\n',
    count: 1,
  },
  {
    name: "runtime-namespace-profile",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; namespace Marker { export const value = 0; } void Marker; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "runtime-import-equals-profile",
    code: 'import React from "react";\nimport Marker = require("example-value");\nexport const Parent = () => { const Press = () => {}; void Marker; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "runtime-export-assignment-profile",
    code: 'import React from "react";\nconst Parent = () => { const Press = () => {}; return <button onClick={Press}>Press</button>; };\nexport = Parent;\n',
    count: 1,
  },
  {
    name: "runtime-parameter-property-profile",
    code: 'import React from "react";\nclass Marker { constructor(public value: number) {} }\nexport const Parent = () => { const Press = () => {}; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "global-eval-reference-other-owner",
    code: 'import React from "react";\nconst observe = () => { void eval; }; void observe;\nexport const Parent = () => { const Press = () => {}; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "erased-type-query-not-runtime-eval",
    code: 'import React from "react";\ntype Evaluator = typeof eval;\nexport const Parent = () => { const Press = () => {}; return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "mixed-callback-argument-reference",
    code: 'import React from "react";\nimport { consume } from "example-value";\nexport const Parent = () => { const Press = () => {}; consume(Press); return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "mixed-alias-render-reference",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => {}; const Forwarded = Press; return <div><button onClick={Press}>Press</button><Forwarded /></div>; };\n',
    count: 1,
  },
  {
    name: "provider-argument-exposure",
    code: 'import React from "react";\nimport { Button } from "antd";\nimport { inspect } from "example-value";\ninspect(Button);\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "own-custom-hook-shaped-call",
    code: 'import React from "react";\nimport { useAction } from "example-hooks";\nexport const Parent = () => { const Press = () => { useAction(); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "own-discarded-create-element",
    code: 'import React from "react";\nexport const Parent = () => { const Press = () => { React.createElement("span"); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "renamed-native-hook-own-call",
    code: 'import React, { useState as readState } from "react";\nexport const Parent = () => { const Press = () => { readState(0); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "aliased-create-element-own-call",
    code: 'import React from "react";\nconst buildElement = React.createElement;\nexport const Parent = () => { const Press = () => { buildElement("span"); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "second-canonical-button-value-exposure",
    code: 'import React from "react";\nimport { Button, Button as OtherButton } from "antd";\nvoid OtherButton;\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "second-canonical-button-jsx-only",
    code: 'import React from "react";\nimport { Button, Button as OtherButton } from "antd";\nexport const Parent = () => { const Press = () => {}; return <div><Button onClick={Press}>Press</Button><OtherButton>Other</OtherButton></div>; };\n',
    count: 0,
  },
  {
    name: "unused-second-canonical-button",
    code: 'import React from "react";\nimport { Button, Button as OtherButton } from "antd";\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 0,
  },
  {
    name: "function-declaration-own-self-argument",
    code: 'import React from "react";\nimport { consume } from "example-values";\nexport const Parent = () => { function Press() { consume(Press); } return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "named-function-expression-own-self-capture",
    code: 'import React from "react";\nexport const Parent = () => { const Press = function Self() { const readSelf = () => Self; void readSelf; }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "function-parameter-shadows-own-name",
    code: 'import React from "react";\nimport { consume } from "example-values";\nexport const Parent = () => { function Press(Press) { consume(Press); } return <button onClick={Press}>Press</button>; };\n',
    count: 0,
  },
  {
    name: "same-module-namespace-provider-exposure",
    code: 'import React from "react";\nimport { Button } from "antd";\nimport * as Antd from "antd";\nvoid Antd;\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "arrow-self-argument-already-closed",
    code: 'import React from "react";\nimport { consume } from "example-values";\nexport const Parent = () => { const Press = () => { consume(Press); }; return <button onClick={Press}>Press</button>; };\n',
    count: 1,
  },
  {
    name: "exposed-default-antd-carrier",
    code: 'import React from "react";\nimport Antd, { Button } from "antd";\nvoid Antd;\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 1,
  },
  {
    name: "unused-default-antd-carrier",
    code: 'import React from "react";\nimport Antd, { Button } from "antd";\nexport const Parent = () => { const Press = () => {}; return <Button onClick={Press}>Press</Button>; };\n',
    count: 0,
  },
];

describe("no-nested-component-definition event callbacks", () => {
  it.each(cases)("$name", ({ code, count }) => {
    const result = runRule(noNestedComponentDefinition, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
