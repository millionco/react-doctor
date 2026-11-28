import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const ownedObservers = `import { useEffect, useRef } from "react";

export function Tray({ revision }: { revision: number }) {
  const trayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = trayRef.current;
    if (!panel) return;

    const sizeObserver = new ResizeObserver(() => {});
    const watchTiles = () => {
      for (const tile of panel.children) sizeObserver.observe(tile);
    };
    watchTiles();

    const childObserver = new MutationObserver(() => {
      watchTiles();
    });
    childObserver.observe(panel, { childList: true, subtree: false });
    return () => {
      childObserver.disconnect();
      sizeObserver.disconnect();
    };
  }, [revision]);

  return <div ref={trayRef}><section>{revision}</section></div>;
}`;

describe("effect-needs-cleanup with observers that share a local registration helper", () => {
  it("recognizes both disconnects after setup and native mutation delivery", () => {
    const result = runRule(effectNeedsCleanup, ownedObservers);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes either order of paired disconnects", () => {
    const source = ownedObservers.replace(
      "childObserver.disconnect();\n      sizeObserver.disconnect();",
      "sizeObserver.disconnect();\n      childObserver.disconnect();",
    );
    expect(runRule(effectNeedsCleanup, source).diagnostics).toEqual([]);
  });

  it.each([
    ["customized built-in element", "<div ref=", '<div is="custom-tray" ref='],
    ["spread with unknown element attributes", "<div ref=", "<div {...attributes} ref="],
    [
      "custom JSX factory",
      "import { useEffect",
      "/** @jsx createOtherElement */\nimport { useEffect",
    ],
    [
      "a replaced disconnect method",
      "export function",
      "MutationObserver.prototype.disconnect = () => {};\nexport function",
    ],
    [
      "an escaped native constructor",
      "export function",
      "registerObserver(MutationObserver);\nexport function",
    ],
    [
      "a registration options getter",
      "childList: true",
      "get childList() { beforeRegister(); return true; }",
    ],
    [
      "throwing work before cleanup registration",
      "    return () => {",
      "    validateSetup();\n    return () => {",
    ],
    [
      "reentrant work before observing",
      "      watchTiles();",
      "      beforeDelivery();\n      watchTiles();",
    ],
    [
      "an escaping registration helper",
      "    watchTiles();",
      "    retain(watchTiles);\n    watchTiles();",
    ],
    ["missing mutation observer cleanup", "      childObserver.disconnect();\n", ""],
    ["missing resize observer cleanup", "      sizeObserver.disconnect();\n", ""],
    [
      "potentially interrupted cleanup",
      "      sizeObserver.disconnect();",
      "      afterMutationCleanup();\n      sizeObserver.disconnect();",
    ],
  ])("keeps the warning with %s", (_description, search, replacement) => {
    const source = ownedObservers.replace(search, replacement);
    expect(source).not.toBe(ownedObservers);
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("`observe` creates a subscription"),
      ),
    ).toBe(true);
  });
});
