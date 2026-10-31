import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

describe("rules-of-hooks plain-class custom Hook fields", () => {
  it.each([
    {
      name: "plain-instance-custom-hook",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = () => { const [items] = useState(0); return items; }; }\nconst model = new Model();\nfunction useOrdinaryItems(){ return useState(0); }\nconst Panel = () => { const { useItems } = model; const items = useItems(); useOrdinaryItems(); return <span>{items}</span>; };\n',
      expected: 0,
    },
    {
      name: "ordinary-instance-field",
      source:
        'import React, { useState } from "react";\nclass Model { load = () => { return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "ordinary-class-method",
      source:
        'import React, { useState } from "react";\nclass Model { useItems() { return useState(0); } }\n',
      expected: 1,
    },
    {
      name: "constructor",
      source:
        'import React, { useState } from "react";\nclass Model { constructor() { useState(0); } }\n',
      expected: 1,
    },
    {
      name: "react-class-field",
      source:
        'import React, { useState } from "react";\nclass Panel extends React.Component { useItems = () => { return useState(0); }; render() { return null; } }\n',
      expected: 1,
    },
    {
      name: "unknown-superclass-field",
      source:
        'import React, { useState } from "react";\nclass Model extends Provider { useItems = () => { return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "static-custom-hook-field",
      source:
        'import React, { useState } from "react";\nclass Model { static useItems = () => { return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "conditional-custom-hook-field",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = (enabled) => { if (enabled) return useState(0); return null; }; }\n',
      expected: 1,
    },
    {
      name: "async-custom-hook-field",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = async () => { return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "loop-custom-hook-field",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = () => { for (const item of [1,2]) { useState(item); } return null; }; }\n',
      expected: 1,
    },
    {
      name: "try-custom-hook-field",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = () => { try { return useState(0); } catch { return null; } }; }\n',
      expected: 1,
    },
    {
      name: "nested-ordinary-callback",
      source:
        'import React, { useState } from "react";\nclass Model { useItems = () => { const handler = () => { return useState(0); }; return handler; }; }\n',
      expected: 1,
    },
    {
      name: "class-expression hook field",
      source:
        'import React, { useState, useMemo } from "react";\nconst Model = class { useCounter = () => useState(0); };\n',
      expected: 0,
    },
    {
      name: "explicit-public readonly hook field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { public readonly useCounter = () => useState(0); }\n',
      expected: 0,
    },
    {
      name: "ordinary custom-hook parameters",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = (initial: number) => useState(initial); }\n',
      expected: 0,
    },
    {
      name: "multiple genuine Hooks",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = () => { const [count] = useState(0); return useMemo(() => count + 1, [count]); }; }\n',
      expected: 0,
    },
    {
      name: "computed string field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { ["useCounter"] = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "string-keyed field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { "useCounter" = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "private identifier field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { #useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "private accessibility",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { private useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "protected accessibility",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { protected useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "bare use field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { use = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "lowercase use-prefix field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useful = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "component-named field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { Counter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "function-expression field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = function useCounter() { return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "decorated field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { @decorate useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "decorated class",
      source:
        'import React, { useState, useMemo } from "react";\n@decorate class Model { useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "early-return field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = (enabled) => { if (!enabled) return null; return useState(0); }; }\n',
      expected: 1,
    },
    {
      name: "ternary field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = (enabled) => enabled ? useState(0) : null; }\n',
      expected: 1,
    },
    {
      name: "logical field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = (enabled) => enabled && useState(0); }\n',
      expected: 1,
    },
    {
      name: "anonymous callback inside field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = () => useMemo(() => useState(0), []); }\n',
      expected: 1,
    },
    {
      name: "map callback inside field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = () => [1, 2].map(() => useState(0)); }\n',
      expected: 1,
    },
    {
      name: "method containing named custom Hook",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { build() { const useCounter = () => useState(0); return useCounter; } }\n',
      expected: 0,
    },
    {
      name: "nested class ordinary field",
      source:
        'import React, { useState, useMemo } from "react";\nclass Model { useCounter = () => { class Child { load = () => useState(0); } return Child; }; }\n',
      expected: 1,
    },
    {
      name: "React PureComponent inheritance",
      source:
        'import React, { useState, useMemo } from "react";\nclass Panel extends React.PureComponent { useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "named React Component inheritance",
      source:
        'import React, { useState, useMemo } from "react";\nimport { Component } from "react"; class Panel extends Component { useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "renamed genuine state Hook",
      source:
        'import React, { useState, useMemo } from "react";\nimport { useState as useCounterState } from "react"; class Model { useCounter = () => useCounterState(0); }\n',
      expected: 0,
    },
    {
      name: "ordinary Hook remains valid",
      source:
        'import React, { useState, useMemo } from "react";\nconst useCounter = () => useState(0); const Counter = () => { const [count] = useCounter(); return <span>{count}</span>; };\n',
      expected: 0,
    },
    {
      name: "bare anonymous unbound class",
      source: 'import { useState } from "react";\n(class { useCounter = () => useState(0); });\n',
      expected: 1,
    },
    {
      name: "standalone named class expression",
      source:
        'import { useState } from "react";\n(class CounterModel { useCounter = () => useState(0); });\n',
      expected: 0,
    },
    {
      name: "transparent bound class expression",
      source:
        'import { useState } from "react";\nconst CounterModel = (class { useCounter = () => useState(0); } satisfies object);\n',
      expected: 0,
    },
    {
      name: "class expression passed as argument",
      source:
        'import { useState } from "react";\nregister(class { useCounter = () => useState(0); });\n',
      expected: 1,
    },
    {
      name: "class expression assigned later",
      source:
        'import { useState } from "react";\nlet CounterModel; CounterModel = class { useCounter = () => useState(0); };\n',
      expected: 1,
    },
    {
      name: "anonymous default-export class",
      source:
        'import { useState } from "react";\nexport default class { useCounter = () => useState(0); }\n',
      expected: 1,
    },
    {
      name: "named default-export class",
      source:
        'import { useState } from "react";\nexport default class CounterModel { useCounter = () => useState(0); }\n',
      expected: 0,
    },
    {
      name: "manual class marker with render alias",
      source:
        'import React, { useState } from "react";\nclass Panel { useCounter = () => useState(0); render = this.useCounter; } Panel.prototype.isReactComponent = {}; export default Panel;\n',
      expected: 1,
    },
    {
      name: "own render method",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); render() { return null; } }\n',
      expected: 1,
    },
    {
      name: "literal computed render alias",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); ["render"] = this.useCounter; }\n',
      expected: 1,
    },
    {
      name: "template computed render alias",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); [`render`] = this.useCounter; }\n',
      expected: 1,
    },
    {
      name: "unknown computed class member",
      source:
        'import React, { useState } from "react";\ndeclare const memberName: string; class Model { useCounter = () => useState(0); [memberName] = this.useCounter; }\n',
      expected: 1,
    },
    {
      name: "own component marker",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); isReactComponent() {} }\n',
      expected: 1,
    },
    {
      name: "direct prototype exposure",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } Model.prototype.isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "constant alias prototype exposure",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } const Alias = Model; Alias.prototype.isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "resolved prototype projection",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } const propertyName = "prototype"; Model[propertyName].isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "direct member marker exposure",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } Model.isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "unknown class projection",
      source:
        'import React, { useState } from "react";\ndeclare const propertyName: string; class Model { useCounter = () => useState(0); } Model[propertyName];\n',
      expected: 1,
    },
    {
      name: "bound named expression external prototype",
      source:
        'import React, { useState } from "react";\nconst Model = class Internal { useCounter = () => useState(0); }; Model.prototype.isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "named expression internal prototype",
      source:
        'import React, { useState } from "react";\nconst Model = class Internal { useCounter = () => useState(0); static initialize() { Internal.prototype.isReactComponent = {}; } };\n',
      expected: 1,
    },
    {
      name: "transparent binding prototype exposure",
      source:
        'import React, { useState } from "react";\nconst Model = (class { useCounter = () => useState(0); } satisfies object); Model.prototype.isReactComponent = {};\n',
      expected: 1,
    },
    {
      name: "unrelated shadowed class marker",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } { class Model {} Model.prototype.isReactComponent = {}; }\n',
      expected: 0,
    },
    {
      name: "harmless class metadata",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); } const label = Model.name; const arity = Model.length;\n',
      expected: 0,
    },
    {
      name: "harmless class literal members",
      source:
        'import React, { useState } from "react";\nclass Model { useCounter = () => useState(0); ["label"] = "counter"; [`size`] = 0; }\n',
      expected: 0,
    },
  ])("$name", ({ source, expected }) => {
    const result = runRule(rulesOfHooks, source, { filename: "src/control.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
