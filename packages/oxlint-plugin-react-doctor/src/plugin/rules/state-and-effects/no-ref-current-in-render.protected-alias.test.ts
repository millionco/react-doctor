import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const fixture = (body: string, prefix = "", parameters = "{ value, notify }") =>
  `import { useRef, useEffect } from "react";
   ${prefix}
   const Widget = (${parameters}) => { ${body} };`;

const definition = `Object.defineProperty(container, "entry", { enumerable: false, writable: true });`;

const check = (source: string, count: number) => {
  const result = runRule(noRefCurrentInRender, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("no-ref-current-in-render protected current-value aliases", () => {
  it.each([
    [
      "a metadata member read does not rebind the alias",
      `const container = useRef({}).current; ${definition} const metadata = container.entry; container.entry = value;`,
    ],
    [
      "a destructuring default read does not rebind the alias",
      `const container = useRef({}).current; ${definition} let selected; ({ selected = container } = value); container.entry = value;`,
    ],
    [
      "an own nonconfigurable data key",
      `const container = useRef({}).current; ${definition} container.entry = value;`,
    ],
    [
      "container escapes after the definition",
      `const container = useRef({}).current; ${definition} notify(container); container.entry = value; return container;`,
    ],
    [
      "a prior effect can retain the protected object",
      `const container = useRef({}).current; ${definition} useEffect(() => notify(container), []); container.entry = value; return container;`,
    ],
    [
      "a changed object prototype",
      `const container = useRef({}).current; ${definition} Object.setPrototypeOf(container, { set entry(next) {} }); container.entry = value;`,
    ],
    [
      "a failed accessor conversion",
      `const container = useRef({}).current; ${definition} try { Object.defineProperty(container, "entry", { set(next) {} }); } catch {} container.entry = value;`,
    ],
    [
      "a writable downgrade cannot install a setter",
      `const container = useRef({}).current; ${definition} Object.freeze(container); container.entry = value;`,
    ],
    [
      "static computed syntax",
      `const container = useRef({}).current; Object["defineProperty"](container, "entry", { ["writable"]: true, configurable: false }); container["entry"] = value;`,
    ],
    [
      "an immutable alias chain",
      `const container = useRef({}).current; const forwarded = container; Object.defineProperty(forwarded, "entry", { writable: true }); const next = forwarded; next.entry = value;`,
    ],
    [
      "transparent wrappers",
      `const container = (useRef({}).current satisfies object); ${definition} (container as any).entry = value;`,
    ],
    [
      "a second protected key after the first definition",
      `const container = useRef({ tag: value }).current; ${definition} Object.defineProperty(container, "other", { writable: true }); notify(container); container.other = value;`,
    ],
  ])("reports %s", (_name, body) => check(fixture(body), 1));

  it("supports a named React import alias", () => {
    check(
      `import { useRef as makeRef } from "react"; const Widget = ({value}) => { const container = makeRef({}).current; ${definition} container.entry = value; };`,
      1,
    );
  });

  it("keeps a mutable React namespace origin outside this expansion", () => {
    check(
      `import React from "react"; const Widget = ({value}) => { const container = React.useRef({}).current; ${definition} container.entry = value; };`,
      0,
    );
  });

  it("reports only protected keys", () => {
    check(
      fixture(
        `const container = useRef({}).current; ${definition} Object.defineProperty(container, "other", { writable: true }); container.ordinary = value; container.entry = value; container.other = value;`,
      ),
      2,
    );
  });

  it.each([
    [
      "a conditional write outside the expansion",
      `const container = useRef({}).current; ${definition} if (value) container.entry = value;`,
    ],
    [
      "a throwing path before the write",
      `const container = useRef({}).current; ${definition} throw new Error(); container.entry = value;`,
    ],
    [
      "a caught write outside the expansion",
      `const container = useRef({}).current; ${definition} try { container.entry = value; } catch {}`,
    ],
    [
      "a nested statement outside the expansion",
      `const container = useRef({}).current; ${definition} { container.entry = value; }`,
    ],
    [
      "an unmodeled constant guard",
      `const container = useRef({}).current; ${definition} if (!true) container.entry = value;`,
    ],
    [
      "an always-truthy object alternate",
      `const container = useRef({}).current; ${definition} if ({}) {} else container.entry = value;`,
    ],
    [
      "a literal false write",
      `const container = useRef({}).current; ${definition} if (false) container.entry = value;`,
    ],
    [
      "a zero literal write",
      `const container = useRef({}).current; ${definition} if (0) container.entry = value;`,
    ],
    [
      "a zero BigInt write",
      `const container = useRef({}).current; ${definition} if (0n) container.entry = value;`,
    ],
    [
      "a zero BigInt conditional write",
      `const container = useRef({}).current; ${definition} 0n ? container.entry = value : null;`,
    ],
    [
      "a parenthesized zero BigInt write",
      `const container = useRef({}).current; ${definition} if ((0n)) container.entry = value;`,
    ],
    [
      "a write after return",
      `const container = useRef({}).current; ${definition} return null; container.entry = value;`,
    ],
    ["an unprotected data alias", `const container = useRef({}).current; container.entry = value;`],
    [
      "an existing configurable key",
      `const container = useRef({ entry: null }).current; ${definition} container.entry = value;`,
    ],
    [
      "an accessor initializer",
      `const container = useRef({ set entry(next) {} }).current; ${definition} container.entry = value;`,
    ],
    [
      "a prototype initializer",
      `const container = useRef({ __proto__: {} }).current; ${definition} container.entry = value;`,
    ],
    [
      "a spread initializer",
      `const container = useRef({ ...value }).current; ${definition} container.entry = value;`,
    ],
    [
      "an unknown constructor",
      `const container = useRef(new value()).current; ${definition} container.entry = value;`,
    ],
    [
      "a visible ref holder",
      `const holder = useRef({}); const container = holder.current; ${definition} container.entry = value;`,
    ],
    [
      "a fresh current getter",
      `const holder = useRef({}); Object.defineProperty(holder, "current", { get: () => ({}) }); const container = holder.current; ${definition} container.entry = value;`,
    ],
    [
      "a mutable alias",
      `let container = useRef({}).current; ${definition} container.entry = value;`,
    ],
    [
      "an assignment to a const binding",
      `const container = useRef({}).current; ${definition} container = {}; container.entry = value;`,
    ],
    [
      "a destructuring assignment to the alias",
      `const container = useRef({}).current; ${definition} ({ target: container } = value); container.entry = value;`,
    ],
    [
      "an array assignment to a forwarded alias",
      `const container = useRef({}).current; const forwarded = container; ${definition} [forwarded] = value; forwarded.entry = value;`,
    ],
    [
      "a loop assignment to the alias",
      `const container = useRef({}).current; ${definition} for (container of value) {} container.entry = value;`,
    ],
    [
      "an escape before definition",
      `const container = useRef({}).current; notify(container); ${definition} container.entry = value;`,
    ],
    [
      "a failed definition caught before the write",
      `const container = useRef({}).current; try { ${definition} } catch {} container.entry = value;`,
    ],
    [
      "a conditional definition",
      `const container = useRef({}).current; if (value) { ${definition} } container.entry = value;`,
    ],
    [
      "a non-throwing Reflect definition",
      `const container = useRef({}).current; Reflect.defineProperty(container, "entry", { writable: true }); container.entry = value;`,
    ],
    [
      "a configurable descriptor",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { writable: true, configurable: true }); container.entry = value;`,
    ],
    [
      "a generic descriptor on a getter",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { enumerable: false }); container.entry = value;`,
    ],
    [
      "a descriptor setter",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { set(next) {} }); container.entry = value;`,
    ],
    [
      "an inherited configurable descriptor",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { __proto__: { configurable: true }, writable: true }); container.entry = value;`,
    ],
    [
      "a descriptor spread",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { writable: true, ...value }); container.entry = value;`,
    ],
    [
      "a duplicate descriptor field",
      `const container = useRef({}).current; Object.defineProperty(container, "entry", { writable: true, configurable: false, configurable: true }); container.entry = value;`,
    ],
    [
      "an unknown definition key",
      `const container = useRef({}).current; Object.defineProperty(container, value, { writable: true }); container.entry = value;`,
    ],
    [
      "an unknown write key",
      `const container = useRef({}).current; ${definition} container[value] = value;`,
    ],
    [
      "an event callback",
      `const container = useRef({}).current; ${definition} return <button onClick={() => { container.entry = value; }} />;`,
    ],
    [
      "an effect callback",
      `const container = useRef({}).current; ${definition} useEffect(() => { container.entry = value; }, [value]);`,
    ],
  ])("stays quiet for %s", (_name, body) => check(fixture(body), 0));

  it.each([
    ["a shadowed Object", "", "{ value, Object }"],
    ["a shadowed hook", "", "{ value, useRef }"],
    ["a replaced native method", "Object.defineProperty = () => {};", "{ value }"],
    [
      "a replaced native method through a const alias",
      "const native = Object; native.defineProperty = () => {};",
      "{ value }",
    ],
    [
      "a mutable global root alias",
      "let root = globalThis; root.Object.defineProperty = () => {};",
      "{ value }",
    ],
    ["an aggregate global root escape", "consume({ root: globalThis });", "{ value }"],
    [
      "a conditional native alias rebinding",
      "const intrinsic = Object; if (flag) intrinsic = {}; unknown(intrinsic);",
      "{ value }",
    ],
    [
      "multiple native aliases with rebinding",
      "const first = Object; const second = first; if (flag) first = {}; unknown(second);",
      "{ value }",
    ],
    ["a replaced global constructor", "globalThis.Object = { defineProperty() {} };", "{ value }"],
    ["an opaque native escape", "consume(Object);", "{ value }"],
    ["an aggregate native escape", "consume({ native: Object });", "{ value }"],
    ["an array native escape", "consume([Object]);", "{ value }"],
    [
      "a destructured native alias",
      "const { prototype } = Object; prototype.configurable = true;",
      "{ value }",
    ],
    ["a mutable native alias", "let native = Object;", "{ value }"],
    ["descriptor prototype pollution", "Object.prototype.configurable = true;", "{ value }"],
    [
      "descriptor prototype pollution through an alias",
      "const prototype = Object.prototype; prototype.configurable = true;",
      "{ value }",
    ],
    [
      "prototype pollution through getPrototypeOf",
      "const prototype = Object.getPrototypeOf({}); prototype.configurable = true;",
      "{ value }",
    ],
    [
      "prototype pollution through a constructor",
      "const prototype = ({}).constructor.prototype; prototype.configurable = true;",
      "{ value }",
    ],
    ["a replaced imported hook", "useRef = () => ({current:{}});", "{ value }"],
    ["an opaque hook escape", "consume(useRef);", "{ value }"],
    [
      "a related React namespace mutation",
      'import React from "react"; React.useRef = () => ({current:{}});',
      "{ value }",
    ],
    ["a related React namespace escape", 'import React from "react"; consume(React);', "{ value }"],
    [
      "native method replacement through assign",
      "Object.assign(Object, {defineProperty(){}});",
      "{ value }",
    ],
  ])("stays quiet with %s", (_name, prefix, parameters) => {
    check(
      fixture(
        `const container = useRef({}).current; ${definition} container.entry = value;`,
        prefix,
        parameters,
      ),
      0,
    );
  });
});
