import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../constants/thresholds.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const cases = [
  {
    name: "the existing direct Object.assign behavior",
    body: "Object.assign(ref, { current: 1 });",
    expected: 1,
  },
  {
    name: "an unsupported long captured alias chain",
    body: `${Array.from({ length: FUNCTION_RESOLUTION_MAX_DEPTH + 1 }, (_, index) => `const alias${index} = ${index ? `alias${index - 1}` : "value"};`).join(" ")} const write = () => { ref.current = alias${FUNCTION_RESOLUTION_MAX_DEPTH}; }; write();`,
    expected: 0,
  },
  {
    name: "a short initialized captured alias chain",
    body: "const first = value; const second = first; const third = second; const write = () => { ref.current = third; }; write();",
    expected: 1,
  },
  {
    name: "a Symbol-sensitive update before a later write",
    body: "const inputRef = useRef(value); const write = () => { inputRef.current++; inputRef.current = 1; }; write();",
    expected: 0,
  },
  {
    name: "a Symbol-sensitive compound assignment before a later write",
    body: "const inputRef = useRef(value); const write = () => { inputRef.current += 1; inputRef.current = 1; }; write();",
    expected: 0,
  },
  {
    name: "an unsupported helper update",
    body: "const write = () => { ref.current++; }; write();",
    expected: 0,
  },
  {
    name: "an unsupported helper compound assignment",
    body: "const write = () => { ref.current += 1; }; write();",
    expected: 0,
  },
  {
    name: "the existing direct update behavior",
    body: "ref.current++;",
    expected: 1,
  },
  {
    name: "the existing direct compound assignment behavior",
    body: "ref.current += 1;",
    expected: 1,
  },
  {
    name: "a captured value still in its TDZ",
    body: "const write = () => { ref.current = later; }; write(); const later = value;",
    expected: 0,
  },
  {
    name: "a captured ref still in its TDZ",
    body: "const write = () => { laterRef.current = value; }; write(); const laterRef = useRef(null);",
    expected: 0,
  },
  {
    name: "a transitive captured ref still in its TDZ",
    body: "const write = () => { laterRef.current = value; }; const invoke = () => { write(); }; invoke(); const laterRef = useRef(null);",
    expected: 0,
  },
  {
    name: "a predecessor call still in its TDZ",
    body: "const write = () => { ref.current = value; }; const invoke = () => { later(); write(); }; invoke(); const later = () => {};",
    expected: 0,
  },
  {
    name: "a binary-test return inside the helper",
    body: "const write = () => { if (1 === 1) return; ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a binary-test return before invocation",
    body: "const write = () => { ref.current = value; }; if (1 === 1) return <p/>; write();",
    expected: 0,
  },
  {
    name: "an earlier TDZ in an unrelated initializer",
    body: "const earlier = later; const write = () => { ref.current = value; }; const later = value; write();",
    expected: 0,
  },
  {
    name: "an alias initializer that reads a TDZ binding",
    body: "const earlier = later; const write = () => { ref.current = earlier; }; const later = value; write();",
    expected: 0,
  },
  {
    name: "an unsupported forward capture initialized before invocation",
    body: "const write = () => { ref.current = later; }; const later = value; write();",
    expected: 0,
  },
  {
    name: "an earlier initialized captured value",
    body: "const earlier = value; const write = () => { ref.current = earlier; }; write();",
    expected: 1,
  },
  {
    name: "a TDZ inside a value-producing helper",
    body: "const read = () => later; const write = () => { ref.current = read(); }; write(); const later = value;",
    expected: 0,
  },
  {
    name: "an unsupported getter value",
    body: "const record = { get value() { return later; } }; const write = () => { ref.current = record.value; }; write(); const later = value;",
    expected: 0,
  },
  {
    name: "an unsupported prop-dependent nullish initialization",
    body: "const write = () => { ref.current ??= value; }; write();",
    expected: 0,
  },
  {
    name: "the existing direct prop-dependent guard",
    body: "if (ref.current === null) ref.current = value;",
    expected: 1,
  },
  {
    name: "an unsupported throwing helper body",
    body: "const write = () => { ref.current = value; throw new Error(); }; write();",
    expected: 0,
  },
  {
    name: "a throwing assignment value",
    body: "const stop = () => { throw new Error(); }; const write = () => { ref.current = stop(); }; write();",
    expected: 0,
  },
  {
    name: "a throwing Object.assign source",
    body: "const stop = () => { throw new Error(); }; const write = () => { Object.assign(ref, { current: stop() }); }; write();",
    expected: 0,
  },
  {
    name: "an unsupported sequence call",
    body: "const stop = () => { throw new Error(); }; const write = () => { ref.current = value; }; (stop(), write());",
    expected: 0,
  },
  {
    name: "an unsupported returned write",
    body: "const stop = () => { throw new Error(); }; const write = () => { return (stop(), ref.current = value); }; write();",
    expected: 0,
  },
  {
    name: "a throw before the call",
    body: "const write = () => { ref.current = value; }; throw new Error(); write();",
    expected: 0,
  },
  {
    name: "a throw before the write",
    body: "const write = () => { throw new Error(); ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a local throwing call before the write",
    body: "const stop = () => { throw new Error(); }; const write = () => { stop(); ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a local throwing call before invocation",
    body: "const stop = () => { throw new Error(); }; const write = () => { ref.current = value; }; stop(); write();",
    expected: 0,
  },
  {
    name: "an unsupported conditional helper return",
    body: "const write = () => { if (value) return; ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a constant helper return",
    body: "const write = () => { if (true) return; ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "an unproved loop before invocation",
    body: "const write = () => { ref.current = value; }; while (true) {} write();",
    expected: 0,
  },
  {
    name: "a cleanup-return callback",
    body: "const write = () => { ref.current = value; }; useEffect(() => () => { write(); }, []);",
    expected: 0,
  },
  {
    name: "a directly invoked arrow",
    body: "const write = () => { ref.current = value; }; write();",
    expected: 1,
  },
  {
    name: "a directly invoked function expression",
    body: "const write = function() { ref.current = value; }; write();",
    expected: 1,
  },
  {
    name: "a transitive synchronous call",
    body: "const write = () => { ref.current = value; }; const invoke = () => { write(); }; invoke();",
    expected: 1,
  },
  {
    name: "an unsupported update beside a simple write",
    body: "const write = () => { ref.current = value; ref.current++; }; write();",
    expected: 1,
  },
  {
    name: "an unsupported Object.assign helper",
    body: "const write = () => { Object.assign(ref, { current: value }); }; write();",
    expected: 0,
  },
  {
    name: "an unsupported conditional call",
    body: "const write = () => { ref.current = value; }; if (value) write();",
    expected: 0,
  },
  { name: "an unused helper", body: "const write = () => { ref.current = value; };", expected: 0 },
  {
    name: "an event-only helper",
    body: "const write = () => { ref.current = value; }; return <button onClick={write}/>;",
    expected: 0,
  },
  {
    name: "an effect-only helper",
    body: "const write = () => { ref.current = value; }; useEffect(() => { write(); }, []);",
    expected: 0,
  },
  {
    name: "a deferred callback",
    body: "const write = () => { ref.current = value; }; queueMicrotask(write);",
    expected: 0,
  },
  {
    name: "an escaped helper with a direct call",
    body: "const write = () => { ref.current = value; }; expose(write); write();",
    expected: 0,
  },
  {
    name: "a const function alias",
    body: "const write = () => { ref.current = value; }; const invoke = write; invoke();",
    expected: 0,
  },
  {
    name: "a reassigned alias",
    body: "const write = () => { ref.current = value; }; let invoke = write; invoke = () => {}; invoke();",
    expected: 0,
  },
  {
    name: "a shadowed binding",
    body: "const write = () => { ref.current = value; }; { const write = () => {}; write(); }",
    expected: 0,
  },
  {
    name: "a call behind a false branch",
    body: "const write = () => { ref.current = value; }; if (false) write();",
    expected: 0,
  },
  {
    name: "a call after return",
    body: "const write = () => { ref.current = value; }; return <div/>; write();",
    expected: 0,
  },
  {
    name: "a write after helper return",
    body: "const write = () => { return; ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "an async helper before suspension",
    body: "const write = async () => { ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "an async helper after suspension",
    body: "const write = async () => { await ready; ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "an async caller after suspension",
    body: "const write = () => { ref.current = value; }; const invoke = async () => { await ready; write(); }; invoke();",
    expected: 0,
  },
  {
    name: "a generator helper",
    body: "const write = function*() { ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a parameterized helper",
    body: "const write = (input) => { ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a default parameter",
    body: "const write = (input = value) => { ref.current = input; }; write();",
    expected: 0,
  },
  {
    name: "a call with arguments",
    body: "const write = () => { ref.current = value; }; write(value);",
    expected: 0,
  },
  {
    name: "a bound call",
    body: "const write = () => { ref.current = value; }; const invoke = write.bind(null); invoke();",
    expected: 0,
  },
  {
    name: "a call member",
    body: "const write = () => { ref.current = value; }; write.call(null);",
    expected: 0,
  },
  {
    name: "an optional call",
    body: "const write = () => { ref.current = value; }; write?.();",
    expected: 0,
  },
  {
    name: "a recursive helper",
    body: "const write = () => { write(); ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "mutually recursive helpers",
    body: "const write = () => { invoke(); ref.current = value; }; const invoke = () => { write(); }; write();",
    expected: 0,
  },
  {
    name: "a lazy object initialization inside the helper",
    body: "const write = () => { if (ref.current === null) ref.current = {}; }; write();",
    expected: 0,
  },
  {
    name: "an unsupported conditional prop-dependent initialization",
    body: "const write = () => { if (ref.current === null) ref.current = value; }; write();",
    expected: 0,
  },
  {
    name: "a visible reset beside an unsupported conditional helper",
    body: "const write = () => { if (ref.current === null) ref.current = {}; }; write(); ref.current = null;",
    expected: 1,
  },
  {
    name: "a call before const initialization",
    body: "write(); const write = () => { ref.current = value; };",
    expected: 0,
  },
  {
    name: "a nullish helper initialization",
    body: "const write = () => { ref.current ??= {}; }; write();",
    expected: 0,
  },
  {
    name: "a logical-or helper initialization",
    body: "const write = () => { ref.current ||= {}; }; write();",
    expected: 0,
  },
  {
    name: "the existing direct lazy initialization",
    body: "if (ref.current === null) ref.current = {};",
    expected: 0,
  },
  {
    name: "an unsupported function declaration",
    body: "function write() { ref.current = value; } write();",
    expected: 0,
  },
];

const namespaceMutationCases = [
  {
    name: "a hidden default-parameter Object.assign replacement",
    mutation: "function replace(unused = (Object.assign = () => {})) { var Object; } replace();",
    body: "const write = () => Object.assign(ref, { current: 1 }); write();",
    expected: 0,
  },
  {
    name: "a hidden default-parameter namespace alias replacement",
    mutation:
      "const NativeObject = Object; function replace(unused = (NativeObject.assign = () => {})) { var NativeObject; } replace();",
    body: "const write = () => Object.assign(ref, { current: 1 }); write();",
    expected: 0,
  },
  {
    name: "a throwing replaced method before a later assignment",
    mutation:
      "function replace(unused = (Object.assign = () => { throw new Error(); })) { var Object; } replace();",
    body: "const write = () => { Object.assign(ref, { current: 1 }); ref.current = 2; }; write();",
    expected: 0,
  },
  {
    name: "a throwing replaced method on the assignment RHS",
    mutation:
      "function replace(unused = (Object.assign = () => { throw new Error(); })) { var Object; } replace();",
    body: "const write = () => { ref.current = Object.assign({}, { current: 1 }); }; write();",
    expected: 0,
  },
  {
    name: "an unsupported Object capability despite an unrelated replacement",
    mutation: "function replace(unused = (Object.assign = () => {})) { var Object; } replace();",
    body: "const write = () => { ref.current = 1; }; write();",
    expected: 0,
  },
];

const providerCases = [
  {
    name: "a named-only React provider",
    imports: 'import { useRef } from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "a directly renamed named React import",
    imports: 'import { useRef as useStableRef } from "react";',
    setup: "",
    initializer: "useStableRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "an unsupported default React provider",
    imports: 'import React from "react";',
    setup: "",
    initializer: "React.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unsupported namespace React provider",
    imports: 'import * as React from "react";',
    setup: "",
    initializer: "React.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unsupported const hook alias",
    imports: 'import { useRef } from "react";',
    setup: "const createRef = useRef;",
    initializer: "createRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unsupported const namespace alias",
    imports: 'import React from "react";',
    setup: "const NativeReact = React;",
    initializer: "NativeReact.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a replaced default React provider",
    imports: 'import React from "react";',
    setup:
      "function replace(unused = (React.useRef = () => ({ current: null }))) { var React; } replace();",
    initializer: "React.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a replaced namespace React provider",
    imports: 'import * as React from "react";',
    setup:
      "function replace(unused = (React.useRef = () => ({ current: null }))) { var React; } replace();",
    initializer: "React.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a replaced aliased default React provider",
    imports: 'import React from "react";',
    setup:
      "const NativeReact = React; function replace(unused = (NativeReact.useRef = () => ({ current: null }))) { var NativeReact; } replace();",
    initializer: "NativeReact.useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "mixed named and default React imports",
    imports: 'import React, { useRef } from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "mixed named and namespace provider mutation",
    imports: 'import { useRef } from "react"; import * as React from "react";',
    setup:
      "function replace(unused = (React.useRef = () => ({ current: null }))) { var React; } replace();",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a mixed named default-specifier handle",
    imports: 'import { useRef, default as NativeReact } from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an erased default React import",
    imports: 'import { useRef } from "react"; import type React from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "an erased namespace React import",
    imports: 'import { useRef } from "react"; import type * as React from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "a literal React require handle",
    imports: 'import { useRef } from "react";',
    setup: 'const NativeReact = require("react");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unresolved require handle",
    imports: 'import { useRef } from "react";',
    setup: 'const moduleName = "react"; const NativeReact = require(moduleName);',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an escaped require handle",
    imports: 'import { useRef } from "react";',
    setup: 'const load = require; const NativeReact = load("react");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a literal React dynamic import handle",
    imports: 'import { useRef } from "react";',
    setup: 'const nativeReact = import("react");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unresolved dynamic import handle",
    imports: 'import { useRef } from "react";',
    setup: 'const moduleName = "react"; const nativeReact = import(moduleName);',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a static non-React require",
    imports: 'import { useRef } from "react";',
    setup: 'const other = require("other");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "a static non-React dynamic import",
    imports: 'import { useRef } from "react";',
    setup: 'const other = import("other");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 1,
  },
  {
    name: "a createRequire handle",
    imports: 'import { useRef } from "react"; import { createRequire } from "node:module";',
    setup: "const load = createRequire(import.meta.url);",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a React import-equals handle",
    imports: 'import { useRef } from "react"; import NativeReact = require("react");',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an inactive nullish assignment",
    imports: 'import { useRef } from "react";',
    setup: "",
    initializer: "useRef(1)",
    write: "ref.current ??= value;",
    expected: 0,
  },
  {
    name: "an inactive or assignment",
    imports: 'import { useRef } from "react";',
    setup: "",
    initializer: "useRef(1)",
    write: "ref.current ||= value;",
    expected: 0,
  },
  {
    name: "an inactive and assignment",
    imports: 'import { useRef } from "react";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current &&= value;",
    expected: 0,
  },
  {
    name: "an explicit direct eval capability",
    imports: 'import { useRef } from "react";',
    setup: 'eval("require(\\"react\\").useRef = () => ({ current: null });");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an explicit host eval capability",
    imports: 'import { useRef } from "react";',
    setup: 'globalThis.eval("require(\\"react\\").useRef = () => ({ current: null });");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an aliased eval capability",
    imports: 'import { useRef } from "react";',
    setup: 'const run = eval; run("require(\\"react\\").useRef = () => ({ current: null });");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an explicit Function capability",
    imports: 'import { useRef } from "react";',
    setup: 'Function("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an explicit host Function capability",
    imports: 'import { useRef } from "react";',
    setup: 'globalThis.Function("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an aliased Function capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const build = Function; build("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a static constructor capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const build = (() => {}).constructor; build("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a literal computed constructor capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const build = (() => {})["constructor"]; build("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an unresolved computed capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const key = "constructor"; const build = (() => {})[key]; build("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a destructured constructor capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const { constructor: build } = () => {}; build("require(\\"react\\").useRef = () => ({ current: null });")();',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a reflection capability",
    imports: 'import { useRef } from "react";',
    setup: "const nativeReflect = Reflect;",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an Object reflection capability",
    imports: 'import { useRef } from "react";',
    setup: "const prototype = Object.getPrototypeOf(() => {});",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "an aliased host capability",
    imports: 'import { useRef } from "react";',
    setup:
      'const host = globalThis; host.eval("require(\\"react\\").useRef = () => ({ current: null });");',
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a native VM capability",
    imports: 'import { useRef } from "react"; import { runInThisContext } from "node:vm";',
    setup: "",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
  {
    name: "a host React provider handle",
    imports: 'import { useRef } from "react";',
    setup: "React.useRef = () => ({ current: null });",
    initializer: "useRef(null)",
    write: "ref.current = value;",
    expected: 0,
  },
];

describe("no-ref-current-in-render synchronous local calls", () => {
  it.each(providerCases)("$name", ({ imports, setup, initializer, write, expected }) => {
    const source = `${imports}
${setup}
export function Panel({ value }) {
  const ref = ${initializer};
  const write = () => { ${write} };
  write();
  return <div/>;
}`;
    const result = runRule(noRefCurrentInRender, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
  it.each(namespaceMutationCases)("$name", ({ mutation, body, expected }) => {
    const source = `import { useRef } from "react";
${mutation}
export const Panel = () => {
  const ref = useRef(null);
  ${body}
  return null;
};`;
    const result = runRule(noRefCurrentInRender, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
  it.each(cases)("$name", ({ body, expected }) => {
    const source = `import { useRef, useEffect } from "react";
export function Panel({ value }) {
  const ref = useRef(null);
  ${body}
  return <div/>;
}`;
    const result = runRule(noRefCurrentInRender, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
