import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const registry = `import { useEffect } from "react";

export function TileListeners({ tiles }: { tiles: EventTarget[] }) {
  useEffect(() => {
    const disconnectors: Array<() => void> = [];
    for (const tile of tiles) {
      const onActivation = () => {};
      tile.addEventListener("activate", onActivation);
      disconnectors.push(() => tile.removeEventListener("activate", onActivation));
    }

    const disconnectTiles = () => disconnectors.forEach((disconnect) => disconnect());
    return () => disconnectTiles();
  }, [tiles]);
  return null;
}`;
const replay = "disconnectors.forEach((disconnect) => disconnect())";

describe("effect-needs-cleanup with a forwarded listener registry replay", () => {
  it.each([
    ["single helper", registry],
    [
      "block cleanup",
      registry.replace("return () => disconnectTiles();", "return () => { disconnectTiles(); };"),
    ],
    [
      "helper chain",
      registry.replace(
        "return () => disconnectTiles();",
        "const release = () => { return disconnectTiles(); }; return () => release();",
      ),
    ],
  ])("accepts a complete replay through %s", (_description, source) => {
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "conditional delegation",
      "return () => disconnectTiles();",
      "return () => { if (shouldCleanup) disconnectTiles(); };",
    ],
    [
      "conditional per-entry cleanup",
      replay,
      "disconnectors.forEach((disconnect) => { if (shouldCleanup) disconnect(); })",
    ],
    [
      "deferred per-entry cleanup",
      replay,
      "disconnectors.forEach(async (disconnect) => { await pending; disconnect(); })",
    ],
    ["deferred replay", "() => " + replay, "async () => { await pending; " + replay + "; }"],
    [
      "a shadowed disposer",
      replay,
      "disconnectors.forEach((disconnect) => { const other = () => {}; other(); })",
    ],
    [
      "throwing arguments",
      replay,
      "disconnectors.forEach((disconnect) => disconnect(maybeThrow()))",
    ],
    ["a mutable replay helper", "const disconnectTiles =", "let disconnectTiles ="],
    [
      "an escaped helper",
      "    return () => disconnectTiles();",
      "    retain(disconnectTiles); return () => disconnectTiles();",
    ],
    [
      "a mismatched registry",
      "() => " + replay,
      "() => otherRegistry.forEach((disconnect) => disconnect())",
    ],
    [
      "a registry that loses a disposer",
      "    const disconnectTiles =",
      "    disconnectors.pop(); const disconnectTiles =",
    ],
    [
      "a second opaque registration",
      "    const disconnectTiles =",
      "    disconnectors.push(userDisposer); const disconnectTiles =",
    ],
    [
      "a conditional stored disposer",
      'disconnectors.push(() => tile.removeEventListener("activate", onActivation));',
      'disconnectors.push(() => { if (ready) tile.removeEventListener("activate", onActivation); });',
    ],
    [
      "an effect exit without a cleanup",
      "    const disconnectTiles =",
      "    if (shouldSkipCleanup) return; const disconnectTiles =",
    ],
  ])("keeps the warning with %s", (_description, search, replacement) => {
    const source = registry.replace(search, replacement);
    expect(source).not.toBe(registry);
    const result = runRule(effectNeedsCleanup, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
