import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

const authoredSurface = `import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
interface SurfaceProps {
  node: MutableRefObject<HTMLElement | null>;
  ratio?: { top: number; bottom: number };
  selection: number;
}
export function Surface({ node, ratio, selection }: SurfaceProps) {
  const [enabled, setEnabled] = useState(false);
  const [{ width: oldWidth, height: oldHeight }, setSize] = useState({ width: 0, height: 0 });
  const { top, bottom } = ratio ?? {};
  const memo = useCallback(() => {
    const width = node.current?.clientWidth ?? 0;
    const height = node.current?.clientHeight ?? 0;
    if (ratio) {
      const { top, bottom } = ratio;
      return { width, height: width * (top / bottom) };
    }
    return { width, height };
  }, [node, top, bottom]);
  useEffect(() => {
    if (!enabled || !node.current) return;
    const { width, height } = memo();
    if (width !== oldWidth || height !== oldHeight) {
      setSize({ width, height });
    }
  }, [enabled, node, memo, oldWidth, oldHeight]);
  return <button onClick={() => setEnabled(true)}>Measure</button>;
}`;

const mountedSurface = authoredSurface
  .replace('import type { MutableRefObject } from "react";\n', "")
  .replace("  node: MutableRefObject<HTMLElement | null>;\n", "")
  .replace(
    "{ node, ratio, selection }: SurfaceProps) {",
    "{ ratio, selection }: SurfaceProps) {\n  const node = useRef<HTMLDivElement | null>(null);",
  )
  .replace(
    "return <button onClick={() => setEnabled(true)}>Measure</button>;",
    "return <div ref={node}><button onClick={() => setEnabled(true)}>Measure</button></div>;",
  );

const replaces = (search: string, replacement: string) =>
  authoredSurface.replace(search, replacement);

const getWarningLines = (source: string): Array<number | undefined> => {
  const result = runRule(noChainStateUpdates, source, {
    includeLocations: true,
    filename: "fixture.tsx",
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ line }) => line);
};

const lineOfSetter = (source: string): number =>
  source.split("\n").findIndex((line) => line.trimStart().startsWith("setSize(")) + 1;

describe("no-chain-state-updates memoized DOM measurements", () => {
  it.each([authoredSurface, mountedSurface])("accepts a proven measurement payload", (source) => {
    expect(getWarningLines(source)).toEqual([]);
  });

  it.each([
    [
      "own value rather than a same-named key",
      replaces("return { width, height };", "return { width: selection, height }; "),
    ],
    [
      "unmeasured return path",
      replaces("return { width, height };", "return { width: 0, height: 0 }; "),
    ],
    [
      "fallthrough",
      replaces("return { width, height };", "if (selection) return { width, height }; "),
    ],
    [
      "mixed setter field",
      replaces("setSize({ width, height });", "setSize({ width, height, selection });"),
    ],
    [
      "wrong ref shape",
      replaces(
        "MutableRefObject<HTMLElement | null>",
        "{ current: { clientWidth: number; clientHeight: number } | null }",
      ),
    ],
    [
      "untrusted ref import",
      replaces(
        'import type { MutableRefObject } from "react";',
        'import type { MutableRefObject } from "compat";',
      ),
    ],
    [
      "shadowed DOM type",
      `interface HTMLElement { clientWidth: number; clientHeight: number }\n${authoredSurface}`,
    ],
    [
      "augmented ambient DOM type",
      `declare global { interface HTMLElement { readonly fakeWidth: number } }\n${authoredSurface}`,
    ],
    [
      "getter payload",
      replaces("return { width, height };", "return { get width() { return width; }, height }; "),
    ],
    [
      "proxy payload",
      replaces("return { width, height };", "return new Proxy({ width, height }, {}); "),
    ],
    [
      "reassigned measurement",
      replaces(
        "const width = node.current?.clientWidth ?? 0;",
        "let width = node.current?.clientWidth ?? 0; width = selection;",
      ),
    ],
    [
      "replaced ref slot",
      replaces(
        "const { top, bottom } = ratio ?? {};",
        "node.current = null; const { top, bottom } = ratio ?? {};",
      ),
    ],
    [
      "getter installed on the DOM dimension",
      replaces(
        "const { top, bottom } = ratio ?? {};",
        "Object.defineProperty(node.current, 'clientWidth', { get: () => selection }); const { top, bottom } = ratio ?? {};",
      ),
    ],
    [
      "ref slot replaced by destructuring assignment",
      replaces(
        "const { top, bottom } = ratio ?? {};",
        "[node.current] = [null]; const { top, bottom } = ratio ?? {};",
      ),
    ],
    [
      "dimension written by destructuring assignment",
      replaces(
        "const { width, height } = memo();",
        "const { width, height } = memo(); [node.current.clientWidth] = [selection];",
      ),
    ],
    [
      "local ref with a proxy initializer",
      mountedSurface.replace(
        "useRef<HTMLDivElement | null>(null)",
        "useRef<HTMLDivElement | null>(new Proxy(document.createElement('div'), {}))",
      ),
    ],
    [
      "nullable measurement without a numeric fallback",
      replaces("node.current?.clientWidth ?? 0", "node.current?.clientWidth"),
    ],
    [
      "visibly nonnumeric ratio input",
      authoredSurface
        .replace(
          "const { top, bottom } = ratio ?? {};",
          "const top = { valueOf() { return selection; } }; const { bottom } = ratio ?? {};",
        )
        .replace("const { top, bottom } = ratio;", "const { bottom } = ratio;"),
    ],
    ["missing measured ref dependency", replaces("[node, top, bottom]", "[top, bottom]")],
    ["missing ratio source dependency", replaces("[node, top, bottom]", "[node, top]")],
    [
      "different direct measurements on different returns",
      authoredSurface
        .replace(
          "return { width, height: width * (top / bottom) };",
          "return { width: height * (top / bottom), height };",
        )
        .replace("return { width, height };", "return { width, height: width * (top / bottom) };"),
    ],
    [
      "fresh rest object as a setter state dependency",
      authoredSurface
        .replace(
          "{ width: oldWidth, height: oldHeight }, setSize",
          "{ width: oldWidth, ...rest }, setSize",
        )
        .replace("width !== oldWidth || height !== oldHeight", "width !== oldWidth || height !== 0")
        .replace("[enabled, node, memo, oldWidth, oldHeight]", "[enabled, node, memo, rest]"),
    ],
    [
      "whole-object state dependency",
      authoredSurface
        .replace("[{ width: oldWidth, height: oldHeight }, setSize]", "[size, setSize]")
        .replace("width !== oldWidth || height !== oldHeight", "width !== 0 || height !== 0")
        .replace("[enabled, node, memo, oldWidth, oldHeight]", "[enabled, node, memo, size]"),
    ],
  ])("keeps the warning for %s", (_name, source) => {
    expect(getWarningLines(source)).toEqual([lineOfSetter(source)]);
  });

  it("accepts an ordinary style write through the measured DOM ref", () => {
    const source = replaces(
      "const { width, height } = memo();",
      "const { width, height } = memo(); node.current.style.height = height + 'px';",
    );
    expect(getWarningLines(source)).toEqual([]);
  });

  it("keeps a companion write through the same setter", () => {
    const source = replaces(
      "setSize({ width, height });",
      `const widthScaled = width * 2;
      setSize({ width: widthScaled, height });
      setSize({ width, height });`,
    );
    expect(getWarningLines(source)).toEqual([lineOfSetter(source)]);
  });
});
