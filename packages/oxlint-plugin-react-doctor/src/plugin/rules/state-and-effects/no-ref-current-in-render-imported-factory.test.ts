import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ref-render-factory-"));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const runFactory = (
  helperSource: string,
  callerSource = `import { useRef } from "react";
    import { makeValue } from "./factory";
    const Panel = ({ value }) => {
      const valueRef = useRef(value);
      return makeValue(() => { valueRef.current = value; return value; });
    };`,
) => {
  fs.writeFileSync(path.join(temporaryDirectory, "factory.ts"), helperSource);
  return runRule(noRefCurrentInRender, callerSource, {
    filename: path.join(temporaryDirectory, "panel.tsx"),
  });
};

describe("no-ref-current-in-render imported factories", () => {
  it.each([
    ["direct invocation", `export const makeValue = (compute) => compute();`],
    [
      "React state initialization",
      `import React from "react"; export const makeValue = (compute) => React.useState(() => ({ value: compute() }))[0].value;`,
    ],
    [
      "React memo initialization",
      `import { useMemo as memoize } from "react"; export const makeValue = (compute) => memoize(() => compute(), []);`,
    ],
    [
      "an immediately invoked wrapper",
      `export const makeValue = (compute) => (() => compute())();`,
    ],
    [
      "a parameter behind transparent wrappers",
      `export const makeValue = (compute) => (compute as (() => string))();`,
    ],
    [
      "named initializer metadata",
      `import { useState } from "react"; useState.description = "cache"; export const makeValue = compute => useState(() => compute())[0];`,
    ],
    [
      "a named initializer computed-key read",
      `import { useState } from "react"; ({ [useState]: unrelated } = {}); export const makeValue = compute => useState(() => compute())[0];`,
    ],
    [
      "a named initializer default read",
      `import { useState } from "react"; [unrelated = useState] = []; export const makeValue = compute => useState(() => compute())[0];`,
    ],
    [
      "React namespace metadata",
      `import React from "react"; const description = React.description; export const makeValue = compute => React.useState(() => compute())[0];`,
    ],
    ["a function declaration", `export function makeValue(compute) { return compute(); }`],
  ])("reports %s", (_description, helperSource) => {
    const result = runFactory(helperSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("matches a callback in the second argument position", () => {
    const result = runFactory(
      `export const makeValue = (value, compute) => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { const valueRef = useRef();
         makeValue(value, () => { valueRef.current = value; }); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer phase from a familiar hook name", () => {
    const result = runFactory(
      `import { useEffect } from "react";
       export const useMemoOne = (compute) => { useEffect(() => { compute(); }, []); return 0; };`,
      `import { useRef } from "react"; import { useMemoOne } from "./factory";
       const Panel = ({ value }) => { const valueRef = useRef();
         return useMemoOne(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a default import",
      `export default (compute) => compute();`,
      `import makeValue from "./factory";`,
    ],
    [
      "a const function expression",
      `export const makeValue = function named(compute) { return compute(); };`,
      `import { makeValue } from "./factory";`,
    ],
  ])("reports through %s", (_description, helperSource, importSource) => {
    const result = runFactory(
      helperSource,
      `import { useRef } from "react"; ${importSource}
      const Panel = ({ value }) => { const valueRef = useRef();
        return makeValue(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports both writes in a state initializer and cache-miss factory", () => {
    const result = runFactory(
      `import React from "react";
       export const makeValue = (compute, shouldRefresh) => {
         const [initial] = React.useState(() => ({ value: compute() }));
         const committed = React.useRef(initial);
         const pending = shouldRefresh ? { value: compute() } : committed.current;
         React.useEffect(() => { committed.current = pending; }, [pending]);
         return pending.value;
       };`,
      `import { useRef } from "react";
       import { makeValue as readCached } from "./factory";
       const useValues = (value) => {
         const firstRef = useRef();
         const secondRef = useRef();
         return readCached(() => {
           firstRef.current = value;
           secondRef.current = value;
           return value;
         }, true);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it.each([
    [
      "an unsupported literal array callback",
      `export const makeValue = (compute) => [0].map(() => compute())[0];`,
    ],
    [
      "an effect",
      `import { useEffect } from "react"; export const makeValue = (compute) => { useEffect(() => { compute(); }, []); return 0; };`,
    ],
    [
      "an effect cleanup",
      `import { useEffect } from "react"; export const makeValue = (compute) => { useEffect(() => () => { compute(); }, []); return 0; };`,
    ],
    [
      "an uninvoked closure",
      `export const makeValue = (compute) => { const later = () => compute(); return 0; };`,
    ],
    ["a returned callback", `export const makeValue = (compute) => compute;`],
    [
      "a stored callback",
      `export const makeValue = (compute) => { globalThis.saved = compute; return 0; };`,
    ],
    [
      "a forwarded callback",
      `export const makeValue = (compute) => { unknownHelper(compute); return 0; };`,
    ],
    [
      "a callback escape alongside a direct call",
      `export const makeValue = (compute) => { unknownHelper(compute); return compute(); };`,
    ],
    ["an async helper", `export const makeValue = async (compute) => compute();`],
    ["a generator helper", `export function* makeValue(compute) { yield compute(); }`],
    [
      "an async nested initializer",
      `import { useState } from "react"; export const makeValue = (compute) => useState(async () => compute())[0];`,
    ],
    ["an unreachable call", `export const makeValue = (compute) => { return 0; compute(); };`],
    [
      "a false branch",
      `export const makeValue = (compute) => { if (false) compute(); return 0; };`,
    ],
    [
      "a false initializer branch",
      `import { useState } from "react"; export const makeValue = (compute) => { if (false) return useState(() => compute())[0]; return 0; };`,
    ],
    [
      "a replaced parameter",
      `export const makeValue = (compute) => { compute = () => 0; return compute(); };`,
    ],
    [
      "a destructured replaced parameter",
      `export const makeValue = (compute) => { [compute] = [() => 0]; return compute(); };`,
    ],
    [
      "a replaced export",
      `export function makeValue(compute) { return compute(); } makeValue = () => 0;`,
    ],
    [
      "a replaced const function expression",
      `export const makeValue = function named(compute) { return compute(); }; makeValue = () => 0;`,
    ],
    ["a mutable export", `export let makeValue = (compute) => compute();`],
    [
      "arguments access",
      `export function makeValue(compute) { arguments[0] = () => 0; return compute(); }`,
    ],
    [
      "direct eval",
      `export const makeValue = (compute) => { eval("compute = () => 0"); return compute(); };`,
    ],
    [
      "a shadowed parameter",
      `export const makeValue = (compute) => { { const compute = () => 0; return compute(); } };`,
    ],
    ["an unknown receiver", `export const makeValue = (compute) => queue.map(() => compute())[0];`],
    [
      "a shadowed React initializer",
      `const useState = (compute) => 0; export const makeValue = (compute) => useState(() => compute());`,
    ],
    ["a rest parameter", `export const makeValue = (...compute) => compute[0]();`],
    ["an optional parameter call", `export const makeValue = (compute) => compute?.();`],
  ])("keeps %s quiet", (_description, helperSource) => {
    const result = runFactory(helperSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a reassigned import", `makeValue = () => 0; makeValue(() => { valueRef.current = value; });`],
    [
      "an effect call site",
      `useEffect(() => makeValue(() => { valueRef.current = value; }), [value]);`,
    ],
    [
      "a cleanup call site",
      `useEffect(() => () => makeValue(() => { valueRef.current = value; }), [value]);`,
    ],
    ["an event call site", `const onClick = () => makeValue(() => { valueRef.current = value; });`],
    ["an async callback", `makeValue(async () => { valueRef.current = value; });`],
    ["a generator callback", `makeValue(function* () { valueRef.current = value; });`],
    [
      "an uninvoked nested callback",
      `makeValue(() => { const later = () => { valueRef.current = value; }; return later; });`,
    ],
    [
      "a shadowed import",
      `{ const makeValue = (compute) => 0; makeValue(() => { valueRef.current = value; }); }`,
    ],
    ["an unreachable call site", `return null; makeValue(() => { valueRef.current = value; });`],
    ["a false call site", `if (false) makeValue(() => { valueRef.current = value; });`],
    [
      "documented lazy initialization",
      `makeValue(() => { if (valueRef.current === null) valueRef.current = new Map(); });`,
    ],
  ])("keeps %s quiet", (_description, operation) => {
    const result = runFactory(
      `export const makeValue = (compute) => compute();`,
      `import { useRef, useEffect } from "react";
       import { makeValue } from "./factory";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${operation}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "helper if0",
      "export const makeValue = compute => { if (0) compute(); return 0; };",
      "valueRef.current = value; return value;",
    ],
    [
      "helper if0n",
      "export const makeValue = compute => { if (0n) compute(); return 0; };",
      "valueRef.current = value; return value;",
    ],
    [
      "helper conditional0n",
      "export const makeValue = compute => 0n ? compute() : 0;",
      "valueRef.current = value; return value;",
    ],
    [
      "helper logical0n",
      "export const makeValue = compute => 0n && compute();",
      "valueRef.current = value; return value;",
    ],
    [
      "react namespace write",
      "import React from 'react'; React.useState = () => [0]; export const makeValue = compute => React.useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react namespace object assign",
      "import React from 'react'; Object.assign(React, {useState: () => [0]}); export const makeValue = compute => React.useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react namespace alias write",
      "import React from 'react'; const runtime = React; runtime.useState = () => [0]; export const makeValue = compute => React.useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react namespace unknown escape",
      "import React from 'react'; unknown(React); export const makeValue = compute => React.useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react named write",
      "import { useState } from 'react'; useState = () => [0]; export const makeValue = compute => useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react named default target write",
      "import { useState } from 'react'; [useState = () => [0]] = []; export const makeValue = compute => useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react named object default target write",
      "import { useState } from 'react'; ({ useState = () => [0] } = {}); export const makeValue = compute => useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "react named unknown escape",
      "import { useState } from 'react'; unknown(useState); export const makeValue = compute => useState(() => compute())[0];",
      "valueRef.current = value; return value;",
    ],
    [
      "helper default target write",
      "export function makeValue(compute) { return compute(); } [makeValue = () => 0] = [];",
      "valueRef.current = value; return value;",
    ],
    [
      "helper pattern loop write",
      "export function makeValue(compute) { return compute(); } for ([makeValue] of [[() => 0]]) {}",
      "valueRef.current = value; return value;",
    ],
    [
      "callback if false",
      "export const makeValue = (compute) => compute();",
      "if (false) valueRef.current = value; return value;",
    ],
    [
      "callback return before write",
      "export const makeValue = (compute) => compute();",
      "return value; valueRef.current = value;",
    ],
    [
      "callback if0",
      "export const makeValue = (compute) => compute();",
      "if (0) valueRef.current = value; return value;",
    ],
    [
      "callback if0n",
      "export const makeValue = (compute) => compute();",
      "if (0n) valueRef.current = value; return value;",
    ],
    [
      "callback conditional0n",
      "export const makeValue = (compute) => compute();",
      "0n ? valueRef.current = value : 0; return value;",
    ],
    [
      "callback logical0n",
      "export const makeValue = (compute) => compute();",
      "0n && (valueRef.current = value); return value;",
    ],
  ])("keeps %s quiet", (_description, helperSource, callbackBody) => {
    const result = runFactory(
      helperSource,
      `import { useRef } from "react";
      import { makeValue } from "./factory";
      const Panel = ({ value }) => { const valueRef = useRef();
        return makeValue(() => { ${callbackBody} }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "unknown map",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return queue.map(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "unknown for each",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return queue.forEach(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "literal map",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return [0].map(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; React.useState = () => [0]; const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace object assign",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; Object.assign(React, {useState: () => [0]}); const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace alias write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; const runtime = React; runtime.useState = () => [0]; const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace unknown escape",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; unknown(React); const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace pattern write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; [React.useState = () => [0]] = []; const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; useState = () => [0]; const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named default target",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; [useState = () => [0]] = []; const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named object default target",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; ({useState = () => [0]} = {}); const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named unknown escape",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; unknown(useState); const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "genuine named",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "genuine namespace",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named metadata",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; useState.description = \"cache\"; const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named computed read",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; ({[useState]: unrelated} = {}); const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller named default read",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; [unrelated = useState] = []; const Panel = ({value}) => { const valueRef = useRef(); return useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace computed read",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; ({[React.useState]: unrelated} = {}); const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller namespace default read",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; [unrelated = React.useState] = []; const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "unbound global react",
      "import {useRef} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => { const valueRef = useRef(); return React.useState(() => makeValue(() => { valueRef.current = value; return value; })); };",
      0,
    ],
    [
      "caller use ref write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; useRef = () => ({current: 0}); const Panel = ({value}) => { const valueRef = useRef(); return makeValue(() => { valueRef.current = value; return value; }); };",
      0,
    ],
    [
      "caller use ref pattern write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; [useRef = () => ({current: 0})] = []; const Panel = ({value}) => { const valueRef = useRef(); return makeValue(() => { valueRef.current = value; return value; }); };",
      0,
    ],
    [
      "caller use ref namespace write",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; React.useRef = () => ({current: 0}); const Panel = ({value}) => { const valueRef = React.useRef(); return makeValue(() => { valueRef.current = value; return value; }); };",
      0,
    ],
    [
      "caller use ref namespace escape",
      "import React, {useRef, useState} from 'react'; import {makeValue} from './factory'; unknown(React); const Panel = ({value}) => { const valueRef = React.useRef(); return makeValue(() => { valueRef.current = value; return value; }); };",
      0,
    ],
  ])("checks %s", (_description, callerSource, expectedDiagnostics) => {
    const result = runFactory(`export const makeValue = (compute) => compute();`, callerSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });

  it("preserves transparent ref initializers", () => {
    const result = runFactory(
      `export const makeValue = (compute) => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { const valueRef = (useRef() as { current: unknown });
         return makeValue(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `return (async () => makeValue(() => { valueRef.current = value; }))();`,
    `return (async () => { await task; makeValue(() => { valueRef.current = value; }); })();`,
    `return (function* () { yield makeValue(() => { valueRef.current = value; }); })();`,
  ])("does not follow async or generator caller boundaries", (operation) => {
    const result = runFactory(
      `export const makeValue = (compute) => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { const valueRef = useRef(); ${operation} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "replacedPromise",
      "import {useRef} from 'react'; import {makeValue} from './factory'; globalThis.Promise = class { constructor(compute) {} }; const Panel = ({value}) => {const valueRef = useRef(); return new Promise(() => makeValue(() => { valueRef.current = value; })); };",
    ],
    [
      "replacedArrayFrom",
      "import {useRef} from 'react'; import {makeValue} from './factory'; Array.from = () => []; const Panel = ({value}) => {const valueRef = useRef(); return Array.from([], () => makeValue(() => { valueRef.current = value; })); };",
    ],
    [
      "replacedArrayMap",
      "import {useRef} from 'react'; import {makeValue} from './factory'; Array.prototype.map = () => []; const Panel = ({value}) => {const valueRef = useRef(); return [0].map(() => makeValue(() => { valueRef.current = value; })); };",
    ],
    [
      "genuinePromise",
      "import {useRef} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => {const valueRef = useRef(); return new Promise(() => makeValue(() => { valueRef.current = value; })); };",
    ],
    [
      "genuineArrayFrom",
      "import {useRef} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => {const valueRef = useRef(); return Array.from([], () => makeValue(() => { valueRef.current = value; })); };",
    ],
    [
      "genuineArrayMap",
      "import {useRef} from 'react'; import {makeValue} from './factory';  const Panel = ({value}) => {const valueRef = useRef(); return [0].map(() => makeValue(() => { valueRef.current = value; })); };",
    ],
  ])("keeps unsupported builtin boundary %s quiet", (_description, callerSource) => {
    const result = runFactory(`export const makeValue = (compute) => compute();`, callerSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "if-false-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); if(false) (() => makeValue(() => { valueRef.current = value; }))(); return null; };",
      0,
    ],
    [
      "if0n-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); if(0n) (() => makeValue(() => { valueRef.current = value; }))(); return null; };",
      0,
    ],
    [
      "return-before-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); return null; (() => makeValue(() => { valueRef.current = value; }))(); return null; };",
      0,
    ],
    [
      "return-before-React-initializer",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); return null; useState(() => makeValue(() => { valueRef.current = value; })); return null; };",
      0,
    ],
    [
      "nested-return-before-inner-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); (() => { return null; (() => makeValue(() => { valueRef.current = value; }))(); })(); return null; };",
      0,
    ],
    [
      "nested2-dead-outer-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); return null; (() => (() => makeValue(() => { valueRef.current = value; }))())(); return null; };",
      0,
    ],
    [
      "conditional0n-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); 0n ? (() => makeValue(() => { valueRef.current = value; }))() : null; return null; };",
      0,
    ],
    [
      "if-false-React-initializer",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); if(false) useState(() => makeValue(() => { valueRef.current = value; })); return null; };",
      0,
    ],
    [
      "genuine-nested2-IIFE",
      "import {useRef,useState} from 'react'; import {makeValue} from './factory'; const Panel = ({value}) => { const valueRef=useRef(); (() => (() => makeValue(() => { valueRef.current = value; }))())(); return null; };",
      0,
    ],
  ])(
    "checks outer invocation reachability for %s",
    (_description, callerSource, expectedDiagnostics) => {
      const result = runFactory(`export const makeValue = (compute) => compute();`, callerSource);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );

  it.each([
    [
      "disabled-helper-argument",
      "export const makeValue = (compute, enabled) => enabled ? compute() : 0;",
      "import {useRef} from 'react'; import {makeValue} from './factory-0'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(() => { valueRef.current = value; },false); };",
      0,
    ],
    [
      "enabled-helper-argument",
      "export const makeValue = (compute, enabled) => enabled ? compute() : 0;",
      "import {useRef} from 'react'; import {makeValue} from './factory-1'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(() => { valueRef.current = value; },true); };",
      0,
    ],
    [
      "supplied-callback-parameter",
      "export const makeValue = compute => compute(false);",
      "import {useRef} from 'react'; import {makeValue} from './factory-2'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(enabled => { if(enabled) valueRef.current=value; }); };",
      0,
    ],
    [
      "supplied-callback-default",
      "export const makeValue = compute => compute();",
      "import {useRef} from 'react'; import {makeValue} from './factory-3'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue((enabled=false) => { if(enabled) valueRef.current=value; }); };",
      0,
    ],
    [
      "supplied-callback-arguments",
      "export const makeValue = compute => compute(false);",
      "import {useRef} from 'react'; import {makeValue} from './factory-4'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(function() { if(arguments[0]) valueRef.current=value; }); };",
      0,
    ],
    [
      "supplied-callback-this",
      "export const makeValue = compute => compute();",
      "import {useRef} from 'react'; import {makeValue} from './factory-5'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(function() { if(this) valueRef.current=value; }); };",
      0,
    ],
    [
      "disabled-initializer-argument",
      "import {useState} from 'react'; export const makeValue = (compute, enabled) => useState(() => enabled ? compute() : 0)[0];",
      "import {useRef} from 'react'; import {makeValue} from './factory-6'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(() => { valueRef.current=value; },false); };",
      0,
    ],
    [
      "unconditional-initializer-with-cache-miss",
      "import {useState} from 'react'; export const makeValue = (compute, enabled) => { const [initial]=useState(() => compute()); return enabled ? compute() : initial; };",
      "import {useRef} from 'react'; import {makeValue} from './factory-7'; const Panel=({value})=>{ const valueRef=useRef(); return makeValue(() => { valueRef.current=value; },false); };",
      1,
    ],
  ])(
    "checks bounded callback argument flow for %s",
    (_description, helperSource, callerSource, expectedDiagnostics) => {
      const result = runFactory(helperSource, callerSource.replace(/factory-\d+/g, "factory"));
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );

  it.each([
    [
      "a native truthy BigInt branch",
      `export const makeValue = (compute) => { if (1n) return compute(); return 0; };`,
    ],
    [
      "a conditional cache miss",
      `export const makeValue = (compute, cache) => cache ? cache.value : compute();`,
    ],
  ])("keeps conditional-only factory %s unsupported", (_description, helperSource) => {
    const result = runFactory(helperSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow callback execution in parameter defaults", () => {
    const result = runFactory(
      `export const makeValue = (compute, value = compute()) => 0;`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { const valueRef = useRef();
         return makeValue(() => { valueRef.current = value; }, true); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "initializer-api-escape",
      "import React from 'react'; import {makeValue} from './factory'; unknown(React.useState); const Panel=({value})=>{ const valueRef=React.useRef(); React.useState(() => makeValue(() => { valueRef.current=value; })); return null; };",
      0,
    ],
    [
      "ref-api-escape",
      "import React from 'react'; import {makeValue} from './factory'; unknown(React.useRef); const Panel=({value})=>{ const valueRef=React.useRef(); makeValue(() => { valueRef.current=value; }); return null; };",
      0,
    ],
    [
      "initializer-api-metadata",
      "import React from 'react'; import {makeValue} from './factory'; React.useState.description=\"state\"; const Panel=({value})=>{ const valueRef=React.useRef(); React.useState(() => makeValue(() => { valueRef.current=value; })); return null; };",
      0,
    ],
    [
      "ref-api-metadata",
      "import React from 'react'; import {makeValue} from './factory'; React.useRef.description=\"ref\"; const Panel=({value})=>{ const valueRef=React.useRef(); makeValue(() => { valueRef.current=value; }); return null; };",
      1,
    ],
    [
      "initializer-api-computed-read",
      "import React from 'react'; import {makeValue} from './factory'; ({[React.useState]:other}={}); const Panel=({value})=>{ const valueRef=React.useRef(); React.useState(() => makeValue(() => { valueRef.current=value; })); return null; };",
      0,
    ],
    [
      "ref-api-default-read",
      "import React from 'react'; import {makeValue} from './factory'; [other=React.useRef]=[]; const Panel=({value})=>{ const valueRef=React.useRef(); makeValue(() => { valueRef.current=value; }); return null; };",
      1,
    ],
    [
      "caller-IIFE-input",
      "import React from 'react'; import {makeValue} from './factory';  const Panel=({value})=>{ const valueRef=React.useRef(); ((enabled)=>{if(enabled) makeValue(() => { valueRef.current=value; })})(false);; return null; };",
      0,
    ],
    [
      "caller-IIFE-default-input",
      "import React from 'react'; import {makeValue} from './factory';  const Panel=({value})=>{ const valueRef=React.useRef(); ((enabled=false)=>{if(enabled) makeValue(() => { valueRef.current=value; })})();; return null; };",
      0,
    ],
    [
      "caller-IIFE-arguments",
      "import React from 'react'; import {makeValue} from './factory';  const Panel=({value})=>{ const valueRef=React.useRef(); (function(){if(arguments[0]) makeValue(() => { valueRef.current=value; })})(false);; return null; };",
      0,
    ],
    [
      "caller-IIFE-this",
      "import React from 'react'; import {makeValue} from './factory';  const Panel=({value})=>{ const valueRef=React.useRef(); (function(){if(this) makeValue(() => { valueRef.current=value; })})();; return null; };",
      0,
    ],
    [
      "native-initializer-input",
      "import React from 'react'; import {makeValue} from './factory';  const Panel=({value})=>{ const valueRef=React.useRef(); React.useState(enabled=>{if(enabled) makeValue(() => { valueRef.current=value; })});; return null; };",
      0,
    ],
    [
      "negated-true",
      "import{useRef}from'react';import{makeValue}from'./factory';const Panel=({value})=>{const valueRef=useRef();return makeValue(()=>{if(!true) valueRef.current=value;});};",
      0,
    ],
    [
      "constant-false",
      "import{useRef}from'react';import{makeValue}from'./factory';const Panel=({value})=>{const valueRef=useRef();return makeValue(()=>{const enabled=false; if(enabled) valueRef.current=value;});};",
      0,
    ],
    [
      "constant-comparison",
      "import{useRef}from'react';import{makeValue}from'./factory';const Panel=({value})=>{const valueRef=useRef();return makeValue(()=>{if(1===2) valueRef.current=value;});};",
      0,
    ],
    [
      "conditional-genuine-outside-scope",
      "import{useRef}from'react';import{makeValue}from'./factory';const Panel=({value})=>{const valueRef=useRef();return makeValue(()=>{if(value) valueRef.current=value;});};",
      0,
    ],
    [
      "unconditional-genuine",
      "import{useRef}from'react';import{makeValue}from'./factory';const Panel=({value})=>{const valueRef=useRef();return makeValue(()=>{valueRef.current=value;});};",
      1,
    ],
  ])(
    "checks conservative callable and target scope for %s",
    (_description, callerSource, expectedDiagnostics) => {
      const result = runFactory(`export const makeValue = compute => compute();`, callerSource);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );
  it.each([
    [
      "an uncalled nested component",
      "const Unused = () => makeValue(() => { valueRef.current = value; });",
      0,
    ],
    [
      "an uncalled nested hook",
      "const useUnused = () => makeValue(() => { valueRef.current = value; });",
      0,
    ],
    [
      "captured-ref child delegation",
      "const Child = () => { makeValue(() => { valueRef.current = value; }); return null; };",
      0,
    ],
    ["the ref's component", "makeValue(() => { valueRef.current = value; });", 1],
    ["an unsupported caller IIFE", "(() => makeValue(() => { valueRef.current = value; }))();", 0],
  ])("checks lexical owner scope for %s", (_description, operation, expectedDiagnostics) => {
    const result = runFactory(
      `export const makeValue = compute => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { const valueRef = useRef(); ${operation} return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });

  it("reports within the ref's hook", () => {
    const result = runFactory(
      `export const makeValue = compute => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const useValue = (value) => { const valueRef = useRef();
         makeValue(() => { valueRef.current = value; }); return valueRef; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const Panel = async ({ value }) => { const valueRef = useRef(); await task;
      makeValue(() => { valueRef.current = value; }); return null; };`,
    `function* Panel({ value }) { const valueRef = useRef(); yield 0;
      makeValue(() => { valueRef.current = value; }); return null; }`,
  ])("keeps async and generator owners unsupported", (callerBody) => {
    const result = runFactory(
      `export const makeValue = compute => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory"; ${callerBody}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    ["direct ref replacement", "let valueRef = useRef(); valueRef = { current: 0 };", 0],
    [
      "default-pattern ref replacement",
      "let valueRef = useRef(); [valueRef = { current: 0 }] = [];",
      0,
    ],
    ["loop ref replacement", "let valueRef = useRef(); for (valueRef of [{ current: 0 }]) {}", 0],
    [
      "mutable alias replacement",
      "const root = useRef(); let valueRef = root; valueRef = { current: 0 };",
      0,
    ],
    [
      "root replacement around an immutable alias",
      "let root = useRef(); const valueRef = root; root = { current: 0 };",
      0,
    ],
    [
      "immutable alias pattern replacement",
      "const root = useRef(); const valueRef = root; [valueRef = { current: 0 }] = [];",
      0,
    ],
    [
      "intermediate alias pattern replacement",
      "const root = useRef(); const middle = root; const valueRef = middle; [middle = { current: 0 }] = [];",
      0,
    ],
    [
      "immutable alias chain",
      "const root = useRef(); const middle = root; const valueRef = middle;",
      1,
    ],
    ["ref object metadata", "const valueRef = useRef(); valueRef.description = 'ref';", 1],
    ["ref computed-key read", "const valueRef = useRef(); ({ [valueRef]: other } = {});", 1],
    ["ref default read", "const valueRef = useRef(); [other = valueRef] = [];", 1],
  ])("checks readonly ref bindings for %s", (_description, declarations, expectedDiagnostics) => {
    const result = runFactory(
      `export const makeValue = compute => compute();`,
      `import { useRef } from "react"; import { makeValue } from "./factory";
       const Panel = ({ value }) => { ${declarations}
         makeValue(() => { valueRef.current = value; }); return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("imported factory caller React providers", () => {
  it.each([
    ["assignment", `React.useState = () => [null];`],
    ["an immutable alias", `const Provider = React; Provider.useState = () => [null];`],
    ["a mutable alias", `let Provider = React; Provider.useState = () => [null];`],
    ["an update", `React.useState++;`],
    ["a pattern target", `[React.useState] = [() => [null]];`],
    ["a default target", `[React.useState = () => [null]] = [];`],
    ["deletion", `delete React.useState;`],
    ["Object.assign", `Object.assign(React, { useState: () => [null] });`],
    ["Object.defineProperty", `Object.defineProperty(React, "useState", { value: () => [null] });`],
    ["an unknown computed target", `React[property] = () => [null];`],
    ["an unknown namespace escape", `mutate(React);`],
    ["an unknown API value escape", `mutate(React.useState);`],
    ["another default import", `import Provider from "react"; Provider.useState = () => [null];`],
    [
      "a default-as import",
      `import { default as Provider } from "react"; Provider.useState = () => [null];`,
    ],
    [
      "a namespace default projection",
      `import * as Provider from "react"; Provider.default.useState = () => [null];`,
    ],
    [
      "an aliased namespace default projection",
      `import * as Provider from "react"; const Alias = Provider; Alias.default.useState = () => [null];`,
    ],
    [
      "an extracted API before replacement",
      `const captured = React.useState; React.useState = () => [null];`,
    ],
    [
      "an extracted API after replacement",
      `React.useState = () => [null]; const captured = React.useState;`,
    ],
  ])("rejects an unsupported provider with %s", (_description, setup) => {
    const result = runFactory(
      `import React from "react"; export const makeValue = compute => React.useState(() => compute())[0];`,
      `import React from "react"; import { useRef } from "react"; import { makeValue } from "./factory";
       ${setup} const Panel = ({ value }) => { const valueRef = useRef();
         return makeValue(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["metadata", `React.useState.description = "state";`],
    [
      "an immutable alias metadata write",
      `const Provider = React; Provider.useState.description = "state";`,
    ],
    ["a computed-key read", `const { [React.useState]: metadata } = values;`],
    ["a default RHS read", `const [metadata = React.useState] = [];`],
    ["a shadowed provider", `const setup = React => { React.useState = () => [null]; };`],
    ["another property", `React.unrelated = "value";`],
  ])("preserves a genuine provider with %s", (_description, setup) => {
    const result = runFactory(
      `import React from "react"; export const makeValue = compute => React.useState(() => compute())[0];`,
      `import React from "react"; import { useRef } from "react"; import { makeValue } from "./factory";
       ${setup} const Panel = ({ value }) => { const valueRef = useRef();
         return makeValue(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a genuine named import",
      `import { useState as makeState } from "react"; export const makeValue = compute => makeState(() => compute())[0];`,
    ],
    ["a direct call", `export const makeValue = compute => compute();`],
    ["a direct IIFE", `export const makeValue = compute => (() => compute())();`],
    [
      "an alternate direct path",
      `import React from "react"; export const makeValue = compute => { React.useState(() => compute()); return compute(); };`,
    ],
    [
      "an alternate IIFE path",
      `import React from "react"; export const makeValue = compute => { React.useState(() => compute()); return (() => compute())(); };`,
    ],
  ])("does not replace %s through a default property assignment", (_description, helperSource) => {
    const result = runFactory(
      helperSource,
      `import React from "react"; import { useRef } from "react"; import { makeValue } from "./factory";
       React.useState = () => [null]; const Panel = ({ value }) => { const valueRef = useRef();
         return makeValue(() => { valueRef.current = value; return value; }); };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["useState", "useMemo", "startTransition"])(
    "checks a renamed default helper %s provider",
    (apiName) => {
      const result = runFactory(
        `import { default as Provider } from "react"; export const makeValue = compute => Provider.${apiName}(() => compute());`,
        `import React from "react"; import { useRef } from "react"; import { makeValue } from "./factory";
       React.${apiName} = () => null; const Panel = ({ value }) => { const valueRef = useRef();
         return makeValue(() => { valueRef.current = value; return value; }); };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("rechecks caller providers when the imported proof is cached", () => {
    fs.writeFileSync(
      path.join(temporaryDirectory, "factory.ts"),
      `import React from "react"; export const makeValue = compute => React.useState(() => compute())[0];`,
    );
    const caller = (setup: string) => `import React from "react"; import { useRef } from "react";
      import { makeValue } from "./factory"; ${setup}
      const Panel = ({ value }) => { const valueRef = useRef();
        return makeValue(() => { valueRef.current = value; return value; }); };`;
    const filename = path.join(temporaryDirectory, "panel.tsx");
    const controls: Array<[string, number]> = [
      ["", 1],
      ["React.useState = () => [null];", 0],
      ["", 1],
    ];
    for (const [setup, expected] of controls) {
      const result = runRule(noRefCurrentInRender, caller(setup), { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    }
  });
});
