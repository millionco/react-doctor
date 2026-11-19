import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

const source = `
import { useRef, useState } from "react";

const CHANNEL = Symbol();

export function useRegistry(selected: string) {
  const selection = useRef(selected);
  const [, setVersion] = useState(0);
  const registry = useRef<{ [CHANNEL]: unknown } | undefined>(undefined);
  if (!registry.current) {
    const listeners = new Set();
    const notify = () => {
      const currentSelection = selection.current;
      listeners.forEach((listener) => listener(currentSelection));
      setVersion((version) => version + 1);
    };
    registry.current = { [CHANNEL]: { selection, listeners, notify } };
  }
  return registry.current;
}
`;

const run = (code: string) => runRule(noRefCurrentInRender, code);

describe("no-ref-current-in-render passive ref initialization", () => {
  it("accepts stable ref identities and deferred callbacks in a fresh record", () => {
    const result = run(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a render prop captured by the callback", source.replace("selection.current;", "selected;")],
    [
      "lexical render arguments captured by the callback",
      source.replace("selection.current;", "arguments[0];"),
    ],
    ["lexical this captured by the callback", source.replace("selection.current;", "this.value;")],
    [
      "dynamic access that can invoke the callback before publication",
      source.replace("    registry.current =", '    eval("notify()");\n    registry.current ='),
    ],
    [
      "an eager ref snapshot captured through a const alias",
      source.replace(
        "const notify = () => {\n      const currentSelection = selection.current;",
        "const snapshot = selection.current;\n    const alias = snapshot;\n    const notify = () => {\n      const currentSelection = alias;",
      ),
    ],
    [
      "a render-time call result captured by the callback",
      source.replace(
        "const notify = () => {\n      const currentSelection = selection.current;",
        "const snapshot = getSelection();\n    const notify = () => {\n      const currentSelection = snapshot;",
      ),
    ],
    [
      "a callback alias used before publication",
      source.replace(
        "    registry.current =",
        "    const call = notify;\n    call();\n    registry.current =",
      ),
    ],
    [
      "a collection mutated before publication",
      source.replace(
        "    registry.current =",
        "    listeners.add(() => selected);\n    registry.current =",
      ),
    ],
    [
      "a collection passed to an unknown function",
      source.replace("    registry.current =", "    receive(listeners);\n    registry.current ="),
    ],
    [
      "a constructor parameter that shadows the native Set",
      source.replace("selected: string)", "selected: string, Set: SetConstructor)"),
    ],
    [
      "an eagerly read ref value beside a stored identity",
      source.replace(
        "{ selection, listeners, notify }",
        "{ selection, snapshot: selection.current, listeners, notify }",
      ),
    ],
    [
      "an object getter",
      source.replace(
        "{ selection, listeners, notify }",
        "{ selection, get snapshot() { return selection.current; }, listeners, notify }",
      ),
    ],
    [
      "an unproven computed key",
      source.replace("{ [CHANNEL]: { selection", "{ [selected]: { selection"),
    ],
  ])("retains the warning for %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
