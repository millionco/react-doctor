import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { containsFetchCall } from "./contains-fetch-call.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const parseEffectCallback = (effectBody: string): EsTreeNode => {
  const { program, errors } = parseFixture(`useEffect(() => {\n${effectBody}\n}, []);`);
  expect(errors).toEqual([]);
  let effectCallback: EsTreeNode | null = null;
  walkAst(program, (child) => {
    if (effectCallback) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    effectCallback = getEffectCallback(child);
  });
  if (!effectCallback) throw new Error("fixture has no effect callback");
  return effectCallback;
};

describe("containsFetchCall with stopAtFunctionBoundary", () => {
  it("finds a fetch called directly in the body", () => {
    const effectCallback = parseEffectCallback(
      `fetch("/api/data").then((response) => response.json()).then(console.log);`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(true);
  });

  it("descends into an async IIFE", () => {
    const effectCallback = parseEffectCallback(
      `(async () => {
        const response = await fetch("/api/data");
        console.log(await response.json());
      })();`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(true);
  });

  it("descends into an inner async function declaration invoked in the body", () => {
    const effectCallback = parseEffectCallback(
      `async function loadData() {
        const response = await fetch("/api/data");
        console.log(await response.json());
      }
      loadData();`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(true);
  });

  it("descends into a declarator-bound arrow invoked with void", () => {
    const effectCallback = parseEffectCallback(
      `const loadData = async () => {
        await fetch("/api/data");
      };
      void loadData();`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(true);
  });

  it("follows a chain of synchronously invoked inner functions", () => {
    const effectCallback = parseEffectCallback(
      `const requestData = async () => {
        await fetch("/api/data");
      };
      const loadData = () => {
        void requestData();
      };
      loadData();`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(true);
  });

  it("prunes an event handler declared in the body", () => {
    const effectCallback = parseEffectCallback(
      `const onSubmit = () => { fetch("/api/save", { method: "POST" }); };
      document.forms[0].addEventListener("submit", onSubmit);`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(false);
  });

  it("prunes a returned cleanup arrow", () => {
    const effectCallback = parseEffectCallback(
      `return () => { fetch("/api/track-unmount", { method: "POST" }); };`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(false);
  });

  it("does not collect invocations from inside pruned handlers", () => {
    const effectCallback = parseEffectCallback(
      `const save = () => fetch("/api/save");
      const onClick = () => { save(); };
      element.addEventListener("click", onClick);`,
    );
    expect(containsFetchCall(effectCallback, { stopAtFunctionBoundary: true })).toBe(false);
  });
});

describe("containsFetchCall without options", () => {
  it("finds a fetch nested inside any callback", () => {
    const effectCallback = parseEffectCallback(
      `const onSubmit = () => { fetch("/api/save", { method: "POST" }); };
      document.forms[0].addEventListener("submit", onSubmit);`,
    );
    expect(containsFetchCall(effectCallback)).toBe(true);
  });

  it("returns false when nothing fetch-like is called", () => {
    const effectCallback = parseEffectCallback(`console.log("mounted");`);
    expect(containsFetchCall(effectCallback)).toBe(false);
  });
});
