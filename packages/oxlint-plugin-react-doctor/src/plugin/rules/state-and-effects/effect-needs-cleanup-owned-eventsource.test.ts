import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const fixture = `import { useCallback, useEffect, useRef } from "react";

export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {
  const channel = useRef<EventSource | null>(null);
  const openChannel = useCallback(() => {
    if (!enabled) return;
    const source = new EventSource(endpoint);
    channel.current = source;
    source.addEventListener("done", () => { source.close(); });
    source.onopen = () => {};
    source.onerror = () => { source.close(); };
  }, [endpoint, enabled]);
  useEffect(() => {
    openChannel();
    return () => { channel.current?.close(); };
  }, [openChannel]);
  return null;
}
`;

describe("effect-owned EventSource cleanup", () => {
  it("finds the cleanup for a directly invoked helper that owns a connection", () => {
    const result = runRule(effectNeedsCleanup, fixture, { filename: "ConnectionExample.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "aliased-cleanup-prototype",
      "export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
      "const sourceMethods = EventSource.prototype;\nsourceMethods.close = () => {};\n\nexport function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
    ],
    [
      "aliased-registration-prototype",
      "export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
      'const targetMethods = EventTarget.prototype;\ntargetMethods.addEventListener = () => { throw new Error("custom registration"); };\n\nexport function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n',
    ],
    [
      "cleanup-closes-old-generation",
      "    openChannel();\n    return () => { channel.current?.close(); };\n",
      "    const previous = channel.current;\n    openChannel();\n    return () => { previous?.close(); };\n",
    ],
    [
      "destructured-cleanup-prototype",
      "export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
      "const { prototype: sourceMethods } = EventSource;\nsourceMethods.close = () => {};\n\nexport function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
    ],
    [
      "effect-throws-before-return",
      "    return () => { channel.current?.close(); };\n",
      '    if (endpoint === "/paused") throw new Error("Setup interrupted");\n    return () => { channel.current?.close(); };\n',
    ],
    [
      "handler-event-target",
      "    source.onopen = () => {};\n",
      "    source.onopen = (event) => { const active = event.currentTarget; remember(active); };\n",
    ],
    [
      "handler-receiver-this",
      "    source.onopen = () => {};\n",
      "    source.onopen = function () { bindCurrentChannel(this); };\n",
    ],
    [
      "inherited-registration-replaced",
      "export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n",
      'EventTarget.prototype.addEventListener = function () { throw new Error("custom registration"); };\n\nexport function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n',
    ],
    [
      "ref-escapes",
      "export function ConnectionExample({ endpoint, enabled }: { endpoint: string; enabled: boolean }) {\n  const channel = useRef<EventSource | null>(null);\n",
      "export function ConnectionExample({ endpoint, enabled, observe }: { endpoint: string; enabled: boolean; observe: (ref: { current: EventSource | null }) => void }) {\n  const channel = useRef<EventSource | null>(null);\n  useEffect(() => { observe(channel); }, [observe]);\n",
    ],
    [
      "retained-callback-escapes",
      "  return null;\n",
      '  return <button type="button" onClick={openChannel}>Reconnect</button>;\n',
    ],
    [
      "retained-parent-ref",
      '  const openChannel = useCallback(() => {\n    if (!enabled) return;\n    const source = new EventSource(endpoint);\n    channel.current = source;\n    source.addEventListener("done", () => { source.close(); });\n    source.onopen = () => {};\n    source.onerror = () => { source.close(); };\n  }, [endpoint, enabled]);\n  useEffect(() => {\n    openChannel();\n    return () => { channel.current?.close(); };\n  }, [openChannel]);\n  return null;\n',
      '  function SharedChild() {\n  const openChannel = useCallback(() => {\n    if (!enabled) return;\n    const source = new EventSource(endpoint);\n    channel.current = source;\n    source.addEventListener("done", () => { source.close(); });\n    source.onopen = () => {};\n    source.onerror = () => { source.close(); };\n  }, [endpoint, enabled]);\n  useEffect(() => {\n    openChannel();\n    return () => { channel.current?.close(); };\n  }, [openChannel]);\n  return null;\n  }\n  return <><SharedChild /><SharedChild /></>;\n',
    ],
    [
      "second-setup-call",
      "    return () => { channel.current?.close(); };\n",
      "    openChannel();\n    return () => { channel.current?.close(); };\n",
    ],
    [
      "setup-throws-after-allocation",
      "    source.onopen = () => {};\n",
      '    if (endpoint === "/paused") throw new Error("Setup interrupted");\n    source.onopen = () => {};\n',
    ],
    [
      "slot-overwritten-before-cleanup",
      "    return () => { channel.current?.close(); };\n",
      "    return () => { channel.current = null; };\n",
    ],
  ] as const)("retains the warning for %s", (_, before, after) => {
    expect(fixture).toContain(before);
    const source = fixture.replace(before, after);
    const result = runRule(effectNeedsCleanup, source, { filename: "ConnectionExample.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
