import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const createSource = (
  releaseBody: string,
  effectRemainder = "return () => dispose();",
  beforeRegistration = "",
  declaration = "const subscribers = new Set<() => void>();",
) => `
  import { useEffect } from "react";
  export const Widget = ({ handler }: { handler: () => void }) => {
    useEffect(() => {
      ${declaration}
      const spare = new Set<() => void>();
      const channel = {
        addListener(listener: () => void): () => void {
          subscribers.add(listener);
          return () => { ${releaseBody} };
        },
      };
      ${beforeRegistration}
      const dispose = channel.addListener(handler);
      ${effectRemainder}
    }, [handler]);
    return null;
  };
`;

describe("effect-owned unary listener disposers", () => {
  const rule = wrapWithSemanticContext(effectNeedsCleanup);
  const assertDiagnostics = (source: string, expected: number) => {
    const result = runRule(rule, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  };

  it("recognizes deletion of the same captured listener from the same owned Set", () => {
    assertDiagnostics(createSource("subscribers.delete(listener);"), 0);
  });

  it("allows duplicate calls of the same disposer", () => {
    assertDiagnostics(
      createSource("subscribers.delete(listener);", "return () => { dispose(); dispose(); };"),
      0,
    );
  });

  it.each([
    ["no deletion", createSource("")],
    ["different listener", createSource("subscribers.delete(handler);")],
    ["different Set", createSource("spare.delete(listener);")],
    ["conditional deletion", createSource("if (enabled) subscribers.delete(listener);")],
    [
      "registry escape",
      createSource("subscribers.delete(listener);", undefined, "remember(subscribers);"),
    ],
    [
      "receiver escape",
      createSource("subscribers.delete(listener);", undefined, "remember(channel);"),
    ],
    [
      "replaced receiver method",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        "channel.addListener = () => () => {};",
      ),
    ],
    [
      "reassigned registry",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        "subscribers = spare;",
        "let subscribers = new Set<() => void>();",
      ),
    ],
    [
      "replacement Set method",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        "Set.prototype.delete = () => false;",
      ),
    ],
    [
      "aliased Set prototype",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        "const methods = Set.prototype; methods.delete = () => false;",
      ),
    ],
    [
      "replacement through defineProperty",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        'Object.defineProperty(Set.prototype, "delete", { value: () => false });',
      ),
    ],
    [
      "replaced global Set",
      createSource("subscribers.delete(listener);", undefined, "globalThis.Set = Replacement;"),
    ],
    [
      "escaped Set prototype",
      createSource("subscribers.delete(listener);", undefined, "remember(Set.prototype);"),
    ],
    [
      "shadowed Set constructor",
      createSource(
        "subscribers.delete(listener);",
        undefined,
        "",
        "const Set = CustomSet; const subscribers = new Set();",
      ),
    ],
    [
      "leaking cleanup path",
      createSource("subscribers.delete(listener);", "return () => { if (enabled) dispose(); };"),
    ],
    [
      "throwing cleanup prefix",
      createSource(
        "subscribers.delete(listener);",
        "return () => { throw new Error(); dispose(); };",
      ),
    ],
  ])("still reports %s", (_name, source) => {
    assertDiagnostics(source, 1);
  });
});
