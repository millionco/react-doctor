import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const rule = wrapWithSemanticContext(effectNeedsCleanup) as Rule;
const shimImport =
  'import { useSyncExternalStore as useExternalStore } from "use-sync-external-store/shim";';
const fixture = ({
  provider = shimImport,
  teardown = "return () => { ticket.unsubscribe(); };",
  consumer = "return useExternalStore(listen, snapshot, snapshot);",
} = {}): string => `
  import { useCallback } from "react";
  ${provider}

  type Subscription = { unsubscribe(): void };
  type Queue = { subscribe(observer: { next: () => void }): Subscription };
  const snapshot = () => 0;

  export function useQueueStatus(queue: Queue, other: Subscription, enabled: boolean) {
    const listen = useCallback((notify: () => void) => {
      const ticket = queue.subscribe({ next: notify });
      ${teardown}
    }, [queue, enabled, other]);
    ${consumer}
  }
`;

const diagnostics = (code: string) => {
  const result = runRule(rule, code, { filename: "queue.tsx", includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("effect-needs-cleanup useSyncExternalStore shim", () => {
  it("accepts the disposer returned to the genuine shim import", () => {
    expect(diagnostics(fixture())).toEqual([]);
  });

  it("preserves a caller-owned disposer passed to React", () => {
    expect(
      diagnostics(
        fixture({ provider: shimImport.replace("use-sync-external-store/shim", "react") }),
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "a provider from another module",
      { provider: shimImport.replace("use-sync-external-store/shim", "some-queue") },
    ],
    ["a type-only import", { provider: shimImport.replace("import {", "import type {") }],
    [
      "a callback in the snapshot slot",
      { consumer: "return useExternalStore(snapshot, listen, snapshot);" },
    ],
    [
      "an ordinary invocation that discards the disposer",
      { consumer: "listen(() => {}); return useExternalStore(listen, snapshot, snapshot);" },
    ],
    ["an absent release", { teardown: "return () => {};" }],
    ["a different unsubscribe handle", { teardown: "return () => other.unsubscribe();" }],
    [
      "a branch inside the disposer",
      { teardown: "return () => { if (enabled) ticket.unsubscribe(); };" },
    ],
    ["an optional release", { teardown: "return () => ticket.unsubscribe?.();" }],
  ] as const)("reports a subscription with %s", (_name, options) => {
    const code = fixture(options);
    const findings = diagnostics(code);
    const lines = code.split("\n");
    expect(
      findings.map(({ line }) => (line === undefined ? undefined : lines[line - 1]?.trim())),
    ).toContain("const ticket = queue.subscribe({ next: notify });");
  });
});
