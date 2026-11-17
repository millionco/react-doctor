import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

interface JsonCompletionFixtureOptions {
  imports?: string;
  predicate?: string;
  response?: string;
  payload?: string;
  beforeGuard?: string;
  afterLaunch?: string;
  condition?: string;
  completion?: string;
  cleanup?: string;
  moduleWork?: string;
}

const buildJsonCompletionFixture = ({
  imports = 'import { useEffect, useState } from "react";',
  predicate = `const isCollection = (entry: unknown) =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);`,
  response = 'const response = await fetch("/refresh/status");',
  payload = "const envelope = await response.json().catch(() => ({}));",
  beforeGuard = "",
  afterLaunch = "",
  condition = "!ignore && isCollection(envelope) && isCollection(envelope.result)",
  completion = "setSnapshot(envelope.result as Item);",
  cleanup = "ignore = true; clearInterval(timer);",
  moduleWork = "",
}: JsonCompletionFixtureOptions = {}): string => `
  ${imports}
  interface Item { label: string; }
  ${predicate}
  ${moduleWork}
  const Status = () => {
    const [snapshot, setSnapshot] = useState<Item | null>(null);
    useEffect(() => {
      let ignore = false;
      const refresh = async () => {
        try {
          ${response}
          ${payload}
          if (!response.ok) return;
          ${beforeGuard}
          if (${condition}) { ${completion} }
        } catch {}
      };
      void refresh();
      ${afterLaunch}
      const timer = setInterval(() => { void refresh(); }, 100);
      return () => { ${cleanup} };
    }, []);
    return <output>{snapshot?.label}</output>;
  };
`;

describe("no-fetch-in-effect JSON cancellation", () => {
  it.each(["() =>", "function ()"])(
    "accepts a single immutable %s effect callback alias",
    (callback) => {
      const code = buildJsonCompletionFixture()
        .replace("useEffect(() =>", `const lifecycle = ${callback}`)
        .replace("}, []);", "}; useEffect(lifecycle, []);");
      const result = runRule(noFetchInEffect, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("accepts an anonymous function effect callback", () => {
    const code = buildJsonCompletionFixture().replace("useEffect(() =>", "useEffect(function ()");
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["if (again) lifecycle();", "observe(lifecycle);"])(
    "rejects a named inline effect callback with %s",
    (prefix) => {
      const code = buildJsonCompletionFixture().replace(
        "useEffect(() => {",
        `useEffect(function lifecycle() { ${prefix}`,
      );
      const result = runRule(noFetchInEffect, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(["if (again) inner();", "observe(inner);"])(
    "rejects a named aliased effect callback with %s",
    (prefix) => {
      const code = buildJsonCompletionFixture()
        .replace("useEffect(() => {", `const lifecycle = function inner() { ${prefix}`)
        .replace("}, []);", "}; useEffect(lifecycle, []);");
      const result = runRule(noFetchInEffect, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    ["an escaped callback", "const", "observe(lifecycle); useEffect(lifecycle, []);"],
    ["another binding in the declaration", "const unrelated = 0,", "useEffect(lifecycle, []);"],
    ["a replaced callback", "const", "useEffect(lifecycle, []); lifecycle = replacement;"],
    [
      "a callback property write",
      "const",
      "lifecycle.extra = replacement; useEffect(lifecycle, []);",
    ],
    ["an extra invocation", "const", "lifecycle(); useEffect(lifecycle, []);"],
  ])("retains the warning for an effect alias with %s", (_label, declaration, registration) => {
    const code = buildJsonCompletionFixture()
      .replace("useEffect(() =>", `${declaration} lifecycle = () =>`)
      .replace("}, []);", `}; ${registration}`);
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a closed empty fallback", {}],
    ["a direct JSON result", { payload: "const envelope = await response.json();" }],
    [
      "a block fallback",
      { payload: "const envelope = await response.json().catch(() => { return {}; });" },
    ],
    [
      "a declared type predicate",
      {
        predicate: `function isCollection(entry: unknown): entry is Record<string, unknown> {
          return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
        }`,
      },
    ],
    [
      "nested conjunctions",
      { condition: "(!ignore) && (isCollection(envelope) && isCollection(envelope.result))" },
    ],
    ["a wrapped JSON field", { completion: "setSnapshot((envelope.result)!);" }],
    [
      "unrelated native file indexing and date formatting",
      {
        moduleWork: `const readFirstFile = (event) => event.target.files?.[0];
          const formatDate = (value) => new Date(value).toLocaleString();`,
      },
    ],
    [
      "a nested JSON field with guarded owners",
      { completion: "setSnapshot(envelope.result.details as Item);" },
    ],
  ])("accepts matching cleanup with %s", (_label, options) => {
    const result = runRule(noFetchInEffect, buildJsonCompletionFixture(options));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["an opaque response wrapper", { response: 'const response = await wrap(fetch("/status"));' }],
    ["a non-JSON payload", { payload: "const envelope = await loadEnvelope();" }],
    [
      "an object with a getter",
      { payload: "const envelope = { get result() { notify(); return {}; } };" },
    ],
    [
      "a response mutation",
      { payload: "response.json = other; const envelope = await response.json();" },
    ],
    [
      "an aliased response",
      { payload: "const alias = response; const envelope = await alias.json();" },
    ],
    ["extra JSON arguments", { payload: "const envelope = await response.json(transform);" }],
    [
      "a catch parameter",
      { payload: "const envelope = await response.json().catch(error => ({}));" },
    ],
    [
      "an effectful catch",
      { payload: "const envelope = await response.json().catch(() => { notify(); return {}; });" },
    ],
    [
      "a nonempty fallback",
      { payload: "const envelope = await response.json().catch(() => ({ result: source }));" },
    ],
    [
      "a catch accessor",
      {
        payload:
          "const envelope = await response.json().catch(() => ({ get result() { notify(); return {}; } }));",
      },
    ],
    [
      "a transformed payload",
      { payload: "const envelope = await response.json().then(transform);" },
    ],
    ["a mutable payload", { payload: "let envelope = await response.json();" }],
    ["an escaped payload", { beforeGuard: "observe(envelope);" }],
    ["an escaped child field", { beforeGuard: "observe(envelope.result);" }],
    ["an aliased payload", { beforeGuard: "const alias = envelope;" }],
    ["a payload field write", { beforeGuard: "envelope.result = {};" }],
    ["a payload deletion", { beforeGuard: "delete envelope.result;" }],
    ["a payload callback escape", { beforeGuard: "observe(() => envelope);" }],
    [
      "an OR guard",
      { condition: "!ignore || isCollection(envelope) || isCollection(envelope.result)" },
    ],
    [
      "an inverted flag",
      { condition: "ignore && isCollection(envelope) && isCollection(envelope.result)" },
    ],
    [
      "a later flag check",
      { condition: "isCollection(envelope) && !ignore && isCollection(envelope.result)" },
    ],
    [
      "a negated condition",
      { condition: "!(!ignore && isCollection(envelope) && isCollection(envelope.result))" },
    ],
    [
      "an opaque suffix",
      { condition: "!ignore && isCollection(envelope) && validate(envelope.result)" },
    ],
    [
      "a field read before its owner guard",
      { condition: "!ignore && isCollection(envelope.result) && isCollection(envelope)" },
    ],
    ["a getter suffix", { condition: "!ignore && isCollection(envelope) && external.ready" }],
    ["a flag assignment", { beforeGuard: "ignore = false;" }],
    ["an escaped flag writer", { beforeGuard: "observe(() => { ignore = true; });" }],
    ["a shadow flag", { beforeGuard: "const ignore = false;" }],
    ["an effectful setter argument", { completion: "setSnapshot(transform(envelope.result));" }],
    [
      "an awaited setter argument",
      { completion: "setSnapshot(await transform(envelope.result));" },
    ],
    ["work before the setter", { completion: "notify(); setSnapshot(envelope.result);" }],
    ["an opaque member argument", { completion: "setSnapshot(external.result);" }],
    ["a dynamic JSON key", { completion: "setSnapshot(envelope[key]);" }],
    ["an unguarded nested owner", { completion: "setSnapshot(envelope.result.details.value);" }],
    ["a JSON method call", { completion: "setSnapshot(envelope.result.read());" }],
    ["an intervening cleanup call", { cleanup: "notify(); ignore = true;" }],
    ["a nested cleanup write", { cleanup: "if (ready) ignore = true;" }],
    ["a missing cleanup write", { cleanup: "clearInterval(timer);" }],
    ["an early exit after launch", { afterLaunch: "if (disabled) return;" }],
    ["an explicit throw after launch", { afterLaunch: 'throw new Error("stop");' }],
    ["an opaque callback after launch", { afterLaunch: "notify();" }],
    ["an escaped request owner", { afterLaunch: "observe(refresh);" }],
    [
      "a predicate closure read",
      { predicate: "const isCollection = (entry) => Boolean(entry) && external;" },
    ],
    ["a truthiness predicate", { predicate: "const isCollection = (entry) => Boolean(entry);" }],
    [
      "a nullable object predicate",
      {
        predicate:
          'const isCollection = (entry) => typeof entry === "object" && !Array.isArray(entry);',
      },
    ],
    [
      "an array-permitting predicate",
      { predicate: 'const isCollection = (entry) => Boolean(entry) && typeof entry === "object";' },
    ],
    [
      "a coercive predicate",
      {
        predicate:
          'const isCollection = (entry) => Boolean(entry) && entry == "object" && !Array.isArray(entry);',
      },
    ],
    ["a predicate getter", { predicate: "const isCollection = (entry) => entry.ready;" }],
    ["a predicate callback", { predicate: "const isCollection = (entry) => validate(entry);" }],
    [
      "a callback after record checks",
      {
        predicate: `const isCollection = (entry) =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) && notify();`,
      },
    ],
    [
      "a predicate side effect",
      { predicate: "const isCollection = (entry) => { notify(); return Boolean(entry); };" },
    ],
    [
      "an asynchronous predicate",
      { predicate: "const isCollection = async (entry) => Boolean(entry);" },
    ],
    [
      "a predicate default",
      { predicate: "const isCollection = (entry = external) => Boolean(entry);" },
    ],
    ["a predicate alias", { moduleWork: "const alias = isCollection;" }],
    ["a predicate replacement", { moduleWork: "isCollection = replacement;" }],
    ["a shadowed Boolean", { moduleWork: "const Boolean = replacement;" }],
    ["a shadowed Array", { moduleWork: "const Array = replacement;" }],
    ["a native method replacement", { moduleWork: "Array.isArray = replacement;" }],
    [
      "an aliased native namespace",
      { moduleWork: "const arrayNamespace = Array; arrayNamespace.isArray = replacement;" },
    ],
    ["a global fetch replacement", { moduleWork: "fetch = replacement;" }],
    ["a replaced interval provider", { moduleWork: "setInterval = replacement;" }],
    ["a replaced interval cleanup provider", { moduleWork: "clearInterval = replacement;" }],
    [
      "a reflective native write",
      { moduleWork: 'Object.defineProperty(Array, "isArray", { value: replacement });' },
    ],
    ["a global-object native write", { moduleWork: "globalThis.fetch = replacement;" }],
    ["a response prototype write", { moduleWork: "Response.prototype.json = replacement;" }],
    [
      "a prototype getter installation",
      { moduleWork: 'Object.defineProperty(Object.prototype, "result", { get: notify });' },
    ],
    ["a dynamic reflective write", { moduleWork: "Array[key] = replacement;" }],
    [
      "a namespace runtime write",
      { moduleWork: "namespace Setup { export const changed = (Boolean = replacement); }" },
    ],
    [
      "an enum runtime write",
      { moduleWork: "enum Setup { Changed = (Boolean = replacement, 1) }" },
    ],
    [
      "a parameter-property runtime write",
      { moduleWork: "class Setup { constructor(public value = (Boolean = replacement)) {} }" },
    ],
    ["an export-assignment runtime write", { moduleWork: "export = (Boolean = replacement);" }],
    [
      "a destructured native constructor",
      {
        moduleWork:
          "const { constructor: nativeConstructor } = []; nativeConstructor.isArray = replacement;",
      },
    ],
    [
      "an assigned native constructor",
      {
        moduleWork:
          "let nativeConstructor; ({ constructor: nativeConstructor } = []); nativeConstructor.isArray = replacement;",
      },
    ],
    [
      "a constructor parameter",
      {
        moduleWork:
          "const configure = ({ constructor: nativeConstructor }) => { nativeConstructor.isArray = replacement; }; configure([]);",
      },
    ],
    [
      "a dynamic acquisition key",
      {
        moduleWork:
          "const { [key]: nativeConstructor } = []; nativeConstructor.isArray = replacement;",
      },
    ],
    ["a rest acquisition pattern", { moduleWork: "const { ...copied } = []; inspect(copied);" }],
    [
      "a computed static native constructor",
      {
        moduleWork:
          'const nativeConstructor = []["constructor"]; nativeConstructor.isArray = replacement;',
      },
    ],
    [
      "a template native constructor",
      {
        moduleWork:
          "const nativeConstructor = [][`constructor`]; nativeConstructor.isArray = replacement;",
      },
    ],
    [
      "a wrapped static native constructor",
      {
        moduleWork:
          'const nativeConstructor = [][("constructor" as string)]; nativeConstructor.isArray = replacement;',
      },
    ],
    ["an erased React import", { imports: 'import type { useEffect, useState } from "react";' }],
    ["an erased React specifier", { imports: 'import { useEffect, type useState } from "react";' }],
    [
      "a mutable React namespace",
      {
        imports: 'import React, { useEffect, useState } from "react";',
        moduleWork: "React.useState = replacement;",
      },
    ],
    ["a replaced React import", { moduleWork: "useState = replacement;" }],
    ["an escaped setter", { beforeGuard: "observe(setSnapshot);" }],
    ["a replaced setter", { beforeGuard: "setSnapshot = replacement;" }],
  ])("retains the warning for %s", (_label, options) => {
    const result = runRule(noFetchInEffect, buildJsonCompletionFixture(options));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not borrow a guarded JSON completion for another request", () => {
    const code = buildJsonCompletionFixture({
      response: 'await fetch("/unrelated"); const response = await fetch("/refresh/status");',
    });
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts the same closed launch without an interval", () => {
    const code = buildJsonCompletionFixture()
      .replace("const timer = setInterval(() => { void refresh(); }, 100);", "")
      .replace("ignore = true; clearInterval(timer);", "ignore = true;");
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an initial exit before the closed request launch", () => {
    const code = buildJsonCompletionFixture().replace(
      "let ignore = false;",
      "if (disabled) return; let ignore = false;",
    );
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects implicit disposal before cleanup registration", () => {
    const code = buildJsonCompletionFixture().replace(
      "let ignore = false;",
      'using resource = { [Symbol.dispose]() { throw new Error("stop"); } }; let ignore = false;',
    );
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects an asynchronous effect with await-using disposal", () => {
    const code = buildJsonCompletionFixture()
      .replace("useEffect(() =>", "useEffect(async () =>")
      .replace(
        "let ignore = false;",
        'await using resource = { async [Symbol.asyncDispose]() { throw new Error("stop"); } }; let ignore = false;',
      );
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `if (!ignore && isCollection(envelope) && isCollection(envelope.result)) {}
     else { setSnapshot(envelope.result as Item); }`,
    `if (!ignore && isCollection(envelope) && isCollection(envelope.result)) return;
     setSnapshot(envelope.result as Item);`,
  ])("does not invert a compound condition for another branch", (replacement) => {
    const code = buildJsonCompletionFixture().replace(
      "if (!ignore && isCollection(envelope) && isCollection(envelope.result)) { setSnapshot(envelope.result as Item); }",
      replacement,
    );
    expect(code).toContain(replacement);
    const result = runRule(noFetchInEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["__proto__", "prototype", "constructor", "__defineGetter__", "__lookupGetter__"])(
    "retains prototype machinery through %s",
    (propertyName) => {
      const code = buildJsonCompletionFixture().replaceAll(
        "envelope.result",
        `envelope.${propertyName}`,
      );
      const result = runRule(noFetchInEffect, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([1, 8])(
    "checks shared provider and predicate facts once for %i requests",
    (requestCount) => {
      const fixture = buildJsonCompletionFixture();
      const componentStart = fixture.indexOf("  const Status =");
      const component = fixture.slice(componentStart);
      const code =
        fixture.slice(0, componentStart) +
        Array.from({ length: requestCount }, (_unused, index) =>
          component.replace("const Status =", `const Status${index} =`),
        ).join("\n");
      let providerReferenceReads = 0;
      let predicateParameterReads = 0;
      const measuredRule: Rule = {
        ...noFetchInEffect,
        create: (context) => {
          const scopes = context.scopes;
          const measuredScopes: ScopeAnalysis = {
            ...scopes,
            referenceFor: (node) => {
              if (isNodeOfType(node, "Identifier") && node.name === "Boolean") {
                providerReferenceReads += 1;
              }
              return scopes.referenceFor(node);
            },
            symbolFor: (node) => {
              if (
                isFunctionLike(node.parent) &&
                node.parent.params.some((parameter) => parameter === node)
              ) {
                predicateParameterReads += 1;
              }
              return scopes.symbolFor(node);
            },
          };
          return noFetchInEffect.create({ ...context, scopes: measuredScopes });
        },
      };
      const result = runRule(measuredRule, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
      expect(providerReferenceReads).toBe(1);
      expect(predicateParameterReads).toBe(1);
    },
  );
});
