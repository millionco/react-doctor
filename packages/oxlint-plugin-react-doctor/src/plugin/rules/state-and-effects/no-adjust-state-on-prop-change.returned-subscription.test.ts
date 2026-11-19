import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const rule = wrapWithSemanticContext(noAdjustStateOnPropChange) as Rule;
const returnDisposer = "const dispose = start(); return dispose;";
const releaseListener = "return () => { resource.off(listener); };";

const fixture = (
  disposer = releaseListener,
  effectTail = returnDisposer,
  extraReset = "",
  absenceGuard = "!resource || !key",
): string => `
  import { useCallback, useEffect, useRef, useState } from "react";
  interface Resource {
    on(listener: () => void): void;
    off(listener: () => void): void;
  }

  export function useResourceSnapshot(
    current: Resource | null,
    selection: string,
    other: Resource | null,
  ) {
    const [snapshot, setSnapshot] = useState<Resource | null>(null);
    const [changed, setChanged] = useState(false);
    const [unrelated, setUnrelated] = useState(true);
    const currentRef = useRef<Resource | null>(null);
    const selectionRef = useRef("");

    const start = useCallback(() => {
      const resource = currentRef.current;
      const key = selectionRef.current;
      if (${absenceGuard}) {
        setSnapshot(null);
        ${extraReset}
        return () => {};
      }

      setSnapshot(resource);
      const listener = () => setChanged(true);
      resource.on(listener);
      ${disposer}
    }, []);

    useEffect(() => {
      currentRef.current = current;
      selectionRef.current = selection;
      ${effectTail}
    }, [current, selection, start]);
    return { snapshot, changed, unrelated };
  }
`;

describe("no-adjust-state-on-prop-change returned subscription", () => {
  it("recognizes the state associated with the returned subscription disposer", () => {
    const result = runRule(rule, fixture(), { filename: "resource.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports the prop-driven resets when the resource is always missing", () => {
    const code = fixture().replace(
      "const resource = currentRef.current;",
      "const resource: Resource | null = null;",
    );
    const result = runRule(rule, code, { filename: "resource.tsx", includeLocations: true });
    const lines = code.split("\n");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map(({ line }) => line && lines[line - 1]?.trim())).toEqual([
      "setSnapshot(null);",
      "setSnapshot(resource);",
    ]);
  });

  it.each([
    [
      "an unrelated reset in the same setup helper",
      fixture(undefined, undefined, "setUnrelated(false);"),
    ],
    [
      "an unrelated reset directly in the effect",
      fixture(undefined, "setUnrelated(false); " + returnDisposer),
    ],
    ["a guard unrelated to the subscribed resource", fixture(undefined, undefined, "", "!key")],
    ["a different release callback", fixture("return () => resource.off(() => {});")],
    ["a different release receiver", fixture("return () => other.off(listener);")],
    [
      "a conditional release",
      fixture("return () => { if (key !== 'skip') resource.off(listener); };"),
    ],
    [
      "a resource ref that is never refreshed",
      fixture().replace("currentRef.current = current;", ""),
    ],
    [
      "a resource input overwritten in the effect before setup",
      fixture().replace(
        "selectionRef.current = selection;",
        "selectionRef.current = selection; currentRef.current = null;",
      ),
    ],
    ["an inert disposer after registration", fixture("return () => {};")],
    ["a discarded disposer", fixture(undefined, "start();")],
  ])("reports %s", (_name, code) => {
    const result = runRule(rule, code, { filename: "resource.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
